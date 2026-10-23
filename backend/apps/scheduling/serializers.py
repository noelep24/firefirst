from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.core.tenancy import TenantSerializer

from .models import Assignment, LeaveRequest, Platoon, RotationPattern, ShiftTrade
from .roster import platoon_on


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

    class Meta:
        model = Assignment
        fields = ["id", "user", "user_name", "platoon", "station", "position"]


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
    covering_for = serializers.IntegerField(required=False, help_text="Member this person is covering on a trade")


class RosterSerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True)
    shift_start = serializers.TimeField(required=False)
    shift_hours = serializers.IntegerField(required=False)
    working = RosterPersonSerializer(many=True)
    on_leave = RosterPersonSerializer(many=True)
    traded_off = RosterPersonSerializer(many=True)


class ShiftDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon = serializers.CharField(allow_null=True)
