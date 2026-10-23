from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from apps.core.tenancy import TenantSerializer

from .models import (
    Assignment,
    LeaveRequest,
    OvertimeOffer,
    OvertimeSettings,
    OvertimeShift,
    Platoon,
    RotationPattern,
    ShiftTrade,
    StaffingRule,
    Vacancy,
)
from .offers import describe
from .overtime import list_for
from .roster import build_roster, platoon_on


class PlatoonSerializer(TenantSerializer):
    class Meta:
        model = Platoon
        fields = ["id", "code", "name", "color"]


class RotationPatternSerializer(TenantSerializer):
    class Meta:
        model = RotationPattern
        fields = ["id", "name", "anchor_date", "sequence", "shift_start", "shift_hours", "is_active"]

    def validate(self, attrs):
        department = self.context["request"].user.department
        instance = RotationPattern(department=department, **{**self._current(), **attrs})
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        return attrs

    def _current(self):
        if self.instance is None:
            return {}
        return {f: getattr(self.instance, f) for f in ("name", "anchor_date", "sequence")}

    def save(self, **kwargs):
        pattern = super().save(**kwargs)
        if pattern.is_active:
            RotationPattern.objects.filter(department=pattern.department, is_active=True).exclude(pk=pattern.pk).update(
                is_active=False
            )
        return pattern


class AssignmentSerializer(TenantSerializer):
    user_name = serializers.CharField(source="user.__str__", read_only=True)
    station_name = serializers.StringRelatedField(source="station", read_only=True)
    apparatus_unit = serializers.CharField(source="apparatus.unit_number", read_only=True, default=None)

    class Meta:
        model = Assignment
        fields = [
            "id",
            "user",
            "user_name",
            "platoon",
            "station",
            "station_name",
            "position",
            "apparatus",
            "apparatus_unit",
        ]


class LeaveRequestSerializer(TenantSerializer):
    user_name = serializers.CharField(source="user.__str__", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "user",
            "user_name",
            "leave_type",
            "start_date",
            "end_date",
            "hours",
            "reason",
            "status",
            "reviewed_by",
            "reviewed_at",
            "review_note",
            "created_at",
        ]
        read_only_fields = ["status", "reviewed_by", "reviewed_at", "review_note"]
        extra_kwargs = {"user": {"required": False}}

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date is before start date."})
        request = self.context["request"]
        user = attrs.get("user")
        if user and user != request.user and not request.user.is_officer:
            raise serializers.ValidationError({"user": "Only officers can file leave for someone else."})
        return attrs


class ReviewSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class ShiftTradeSerializer(TenantSerializer):
    requester_name = serializers.CharField(source="requester.__str__", read_only=True)
    covering_member_name = serializers.CharField(source="covering_member.__str__", read_only=True)

    class Meta:
        model = ShiftTrade
        fields = [
            "id",
            "requester",
            "requester_name",
            "covering_member",
            "covering_member_name",
            "shift_date",
            "note",
            "status",
            "reviewed_by",
            "reviewed_at",
            "created_at",
        ]
        read_only_fields = ["requester", "status", "reviewed_by", "reviewed_at"]

    def validate(self, attrs):
        request = self.context["request"]
        requester = request.user
        covering = attrs["covering_member"]
        date = attrs["shift_date"]
        if covering == requester:
            raise serializers.ValidationError({"covering_member": "Pick someone other than yourself."})
        on_duty = platoon_on(requester.department, date)
        if on_duty is not None:
            requester_platoon = getattr(getattr(requester, "assignment", None), "platoon", None)
            covering_platoon = getattr(getattr(covering, "assignment", None), "platoon", None)
            if requester_platoon is None or requester_platoon.code != on_duty:
                raise serializers.ValidationError({"shift_date": "You aren't scheduled to work that day."})
            if covering_platoon is not None and covering_platoon.code == on_duty:
                raise serializers.ValidationError({"covering_member": "That member is already working that day."})
        return attrs


class RosterPersonSerializer(serializers.Serializer):
    user = serializers.IntegerField()
    name = serializers.CharField()
    station = serializers.IntegerField(allow_null=True)
    station_number = serializers.CharField(allow_null=True)
    position = serializers.CharField()
    rank = serializers.CharField()
    apparatus = serializers.IntegerField(allow_null=True, help_text="The rig this person rides")
    apparatus_unit = serializers.CharField(allow_null=True)
    covering_for = serializers.IntegerField(required=False, help_text="Member this person is covering on a trade")
    overtime = serializers.BooleanField(required=False, help_text="Working an overtime shift")


class ShortfallSerializer(serializers.Serializer):
    rule = serializers.IntegerField()
    description = serializers.CharField()
    station = serializers.IntegerField(allow_null=True)
    required = serializers.IntegerField()
    scheduled = serializers.IntegerField()


class StaffingDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True, required=False)
    shortfalls = ShortfallSerializer(many=True)


class StaffingRuleSerializer(TenantSerializer):
    description = serializers.CharField(source="__str__", read_only=True)

    class Meta:
        model = StaffingRule
        fields = ["id", "station", "position", "certification_type", "minimum", "description"]

    def validate_minimum(self, value):
        if value < 1:
            raise serializers.ValidationError("Minimum must be at least 1.")
        return value


class RosterSerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True)
    shift_start = serializers.TimeField(required=False)
    shift_hours = serializers.IntegerField(required=False)
    working = RosterPersonSerializer(many=True)
    on_leave = RosterPersonSerializer(many=True)
    traded_off = RosterPersonSerializer(many=True)
    shortfalls = ShortfallSerializer(many=True)


class ShiftDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True)


class BoardStationSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    number = serializers.CharField()
    name = serializers.CharField()


class BoardMemberSerializer(serializers.Serializer):
    """The signed-in member's standing assignment and whether they work today."""

    name = serializers.CharField()
    rank = serializers.CharField()
    platoon = serializers.CharField(allow_null=True)
    station = BoardStationSerializer(allow_null=True)
    position = serializers.CharField(allow_null=True)
    apparatus = serializers.IntegerField(allow_null=True)
    apparatus_unit = serializers.CharField(allow_null=True)
    on_duty = serializers.BooleanField()
    status = serializers.CharField(help_text="on_duty, covering, on_leave, traded_off or off_duty")
    note = serializers.CharField(allow_blank=True)


class BoardVisitSerializer(serializers.Serializer):
    home_station_number = serializers.CharField(allow_null=True)
    until = serializers.DateField(allow_null=True, help_text="Last day here; null until it's returned")
    covering_for_unit = serializers.CharField(allow_null=True)
    reason = serializers.CharField(allow_blank=True)


class BoardApparatusSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    unit_number = serializers.CharField()
    apparatus_type = serializers.CharField()
    status = serializers.CharField()
    crew = RosterPersonSerializer(many=True)
    visiting = BoardVisitSerializer(allow_null=True, help_text="Set when the rig is here on a temporary move")


class BoardAwaySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    unit_number = serializers.CharField()
    station_number = serializers.CharField()
    until = serializers.DateField(allow_null=True)


class StationBoardSerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True)
    me = BoardMemberSerializer()
    stations = BoardStationSerializer(many=True)
    station = BoardStationSerializer(allow_null=True)
    apparatus = BoardApparatusSerializer(many=True)
    away = BoardAwaySerializer(many=True, help_text="Rigs based here that are at another station today")
    unassigned = RosterPersonSerializer(many=True, help_text="Working at this station without a rig here")
    on_leave = RosterPersonSerializer(many=True)
    traded_off = RosterPersonSerializer(many=True)
    shortfalls = ShortfallSerializer(many=True)


class OvertimeShiftSerializer(TenantSerializer):
    user_name = serializers.CharField(source="user.__str__", read_only=True)
    filling_for_name = serializers.StringRelatedField(source="filling_for", read_only=True)
    station_name = serializers.StringRelatedField(source="station", read_only=True)

    class Meta:
        model = OvertimeShift
        fields = [
            "id",
            "user",
            "user_name",
            "date",
            "hours",
            "filling_for",
            "filling_for_name",
            "station",
            "station_name",
            "mandatory",
            "note",
            "recorded_by",
            "created_at",
        ]
        read_only_fields = ["recorded_by"]

    def validate(self, attrs):
        user = attrs.get("user", getattr(self.instance, "user", None))
        date = attrs.get("date", getattr(self.instance, "date", None))
        filling_for = attrs.get("filling_for", getattr(self.instance, "filling_for", None))
        if filling_for is not None and filling_for == user:
            raise serializers.ValidationError({"filling_for": "A member can't fill their own seat."})
        clash = OvertimeShift.objects.filter(user=user, date=date).exclude(pk=getattr(self.instance, "pk", None))
        if clash.exists():
            raise serializers.ValidationError({"date": f"{user} already has overtime that day."})
        # Someone already on their own shift that day can't also be hired for it.
        roster = build_roster(user.department, date)
        if any(p["user"] == user.id and not p.get("overtime") for p in roster["working"]):
            raise serializers.ValidationError({"user": f"{user} is already on duty that day."})
        return attrs


class OvertimeMemberSerializer(serializers.Serializer):
    user = serializers.IntegerField()
    name = serializers.CharField()
    rank = serializers.CharField()
    position = serializers.CharField()
    platoon = serializers.CharField()
    station_number = serializers.CharField(allow_null=True)
    last_overtime = serializers.DateField(allow_null=True, help_text="Most recent overtime before this date")
    status = serializers.ChoiceField(
        choices=["available", "on_duty", "on_leave", "overtime"], help_text="Whether they can be hired that day"
    )


class OvertimeListSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    members = OvertimeMemberSerializer(many=True)
    next_up = serializers.IntegerField(allow_null=True, help_text="First available member: who to hire next")


class OvertimeBoardSerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True)
    lists = OvertimeListSerializer(many=True)


class OvertimeSettingsSerializer(serializers.ModelSerializer):
    response_hours = serializers.IntegerField(min_value=1, max_value=72)

    class Meta:
        model = OvertimeSettings
        fields = ["response_hours", "voluntary_first", "refusal_moves_to_bottom", "vacancy_from_leave"]


class VacancyOfferSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.__str__", read_only=True)

    class Meta:
        model = OvertimeOffer
        fields = ["id", "user", "user_name", "status", "responded_at"]
        read_only_fields = fields


class VacancySerializer(TenantSerializer):
    description = serializers.SerializerMethodField()
    filling_for_name = serializers.StringRelatedField(source="filling_for", read_only=True)
    station_name = serializers.StringRelatedField(source="station", read_only=True)
    hired_name = serializers.SerializerMethodField()
    hired_mandatory = serializers.SerializerMethodField()
    offers = VacancyOfferSerializer(many=True, read_only=True)
    overtime_list = serializers.ChoiceField(choices=Vacancy.List.choices, required=False, allow_blank=True)

    class Meta:
        model = Vacancy
        fields = [
            "id",
            "date",
            "overtime_list",
            "position",
            "station",
            "station_name",
            "filling_for",
            "filling_for_name",
            "leave_request",
            "hours",
            "note",
            "status",
            "respond_by",
            "description",
            "hired_name",
            "hired_mandatory",
            "offers",
            "created_at",
        ]
        read_only_fields = ["leave_request", "status", "respond_by"]

    def get_description(self, vacancy) -> str:
        return describe(vacancy)

    def get_hired_name(self, vacancy) -> str | None:
        return str(vacancy.overtime_shift.user) if vacancy.overtime_shift else None

    def get_hired_mandatory(self, vacancy) -> bool | None:
        return vacancy.overtime_shift.mandatory if vacancy.overtime_shift else None

    def validate_date(self, value):
        if value < timezone.localdate():
            raise serializers.ValidationError("That day has already passed.")
        return value

    def validate(self, attrs):
        # The empty seat's member tells us the list, position and station when they aren't given.
        for key in ("overtime_list", "position", "station"):
            if not attrs.get(key):
                attrs.pop(key, None)
        member = attrs.get("filling_for")
        assignment = Assignment.objects.filter(user=member).first() if member else None
        if assignment:
            attrs.setdefault("overtime_list", list_for(assignment.position))
            attrs.setdefault("position", assignment.position)
            attrs.setdefault("station", assignment.station)
        if not attrs.get("overtime_list"):
            raise serializers.ValidationError({"overtime_list": "Choose which overtime list fills this seat."})
        if attrs.get("position") and list_for(attrs["position"]) != attrs["overtime_list"]:
            raise serializers.ValidationError({"position": "That position isn't filled from this overtime list."})
        return attrs


class HireSerializer(serializers.Serializer):
    user = serializers.IntegerField()


class OvertimeOfferSerializer(serializers.ModelSerializer):
    """An offer as the member sees it: what the vacancy is and when to answer by."""

    user_name = serializers.CharField(source="user.__str__", read_only=True)
    date = serializers.DateField(source="vacancy.date", read_only=True)
    description = serializers.SerializerMethodField()
    respond_by = serializers.DateTimeField(source="vacancy.respond_by", read_only=True)
    hours = serializers.DecimalField(source="vacancy.hours", max_digits=5, decimal_places=2, read_only=True)
    vacancy_status = serializers.CharField(source="vacancy.status", read_only=True)

    class Meta:
        model = OvertimeOffer
        fields = [
            "id",
            "vacancy",
            "user",
            "user_name",
            "status",
            "responded_at",
            "date",
            "description",
            "respond_by",
            "hours",
            "vacancy_status",
        ]
        read_only_fields = fields

    def get_description(self, offer) -> str:
        return describe(offer.vacancy)
