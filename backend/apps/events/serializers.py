import uuid

from rest_framework import serializers

from apps.core.models import User
from apps.core.tenancy import TenantScopedFieldsMixin, TenantSerializer

from .models import Attendance, Event
from .recurrence import FREQUENCIES, MAX_OCCURRENCES, occurrence_starts


class AttendanceSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.__str__", read_only=True)

    class Meta:
        model = Attendance
        fields = ["user", "user_name", "status"]


class EventSerializer(TenantSerializer):
    attendance = AttendanceSerializer(many=True, read_only=True)
    invitees = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        many=True,
        write_only=True,
        required=False,
        help_text="Members to invite. Mandatory events invite every active member automatically.",
    )
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)
    my_status = serializers.SerializerMethodField()
    repeat = serializers.ChoiceField(
        choices=FREQUENCIES, write_only=True, required=False, default="none", help_text="Only when creating"
    )
    repeat_interval = serializers.IntegerField(
        write_only=True, required=False, default=1, min_value=1, max_value=12, help_text="Every N weeks or months"
    )
    repeat_until = serializers.DateField(write_only=True, required=False, allow_null=True)
    repeat_count = serializers.IntegerField(
        write_only=True, required=False, allow_null=True, min_value=2, max_value=MAX_OCCURRENCES
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "description",
            "category",
            "station",
            "location",
            "starts_at",
            "ends_at",
            "all_day",
            "is_mandatory",
            "training_hours",
            "created_by",
            "attendance",
            "invitees",
            "my_status",
            "series",
            "repeat",
            "repeat_interval",
            "repeat_until",
            "repeat_count",
        ]
        read_only_fields = ["series"]

    def get_my_status(self, obj) -> str | None:
        user = self.context["request"].user
        return next((a.status for a in obj.attendance.all() if a.user_id == user.id), None)

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_at": "Event ends before it starts."})
        if attrs.get("repeat", "none") != "none":
            if self.instance is not None:
                raise serializers.ValidationError({"repeat": "Repeats can only be set when creating an event."})
            if not attrs.get("repeat_until") and not attrs.get("repeat_count"):
                raise serializers.ValidationError({"repeat_until": "Choose when the repeats end."})
            if attrs.get("repeat_until") and attrs["repeat_until"] < starts.date():
                raise serializers.ValidationError({"repeat_until": "Ends before the first occurrence."})
        return attrs

    def create(self, validated_data):
        invitees = validated_data.pop("invitees", [])
        frequency = validated_data.pop("repeat", "none")
        interval = validated_data.pop("repeat_interval", 1)
        until = validated_data.pop("repeat_until", None)
        count = validated_data.pop("repeat_count", None)
        if frequency == "none":
            event = super().create(validated_data)
            self._invite(event, invitees)
            return event

        department = validated_data["department"]
        duration = validated_data["ends_at"] - validated_data["starts_at"]
        starts = occurrence_starts(validated_data["starts_at"], department.timezone, frequency, interval, until, count)
        series = uuid.uuid4()
        first = None
        for start in starts:
            event = Event.objects.create(
                **{**validated_data, "starts_at": start, "ends_at": start + duration, "series": series}
            )
            self._invite(event, invitees)
            first = first or event
        return first

    def update(self, instance, validated_data):
        for name in ("repeat", "repeat_interval", "repeat_until", "repeat_count"):
            validated_data.pop(name, None)
        invitees = validated_data.pop("invitees", [])
        event = super().update(instance, validated_data)
        self._invite(event, invitees)
        return event

    def _invite(self, event, invitees):
        users = set(invitees)
        if event.is_mandatory:
            users |= set(User.objects.filter(department=event.department, is_active=True))
        existing = set(event.attendance.values_list("user_id", flat=True))
        Attendance.objects.bulk_create(Attendance(event=event, user=u) for u in users if u.id not in existing)


class RsvpSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[Attendance.Status.GOING, Attendance.Status.DECLINED])


class AttendanceMarkSerializer(TenantScopedFieldsMixin, serializers.Serializer):
    attended = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), many=True, required=False)
    absent = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), many=True, required=False)


class CalendarLinkSerializer(serializers.Serializer):
    url = serializers.URLField(help_text="https link, for Google Calendar's “From URL”")
    webcal_url = serializers.CharField(help_text="webcal:// link that opens Apple Calendar or Outlook directly")
