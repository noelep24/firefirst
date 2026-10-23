from rest_framework import serializers

from apps.core.models import User
from apps.core.tenancy import TenantScopedFieldsMixin, TenantSerializer

from .models import Attendance, Event


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
        ]

    def get_my_status(self, obj) -> str | None:
        user = self.context["request"].user
        return next((a.status for a in obj.attendance.all() if a.user_id == user.id), None)

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_at": "Event ends before it starts."})
        return attrs

    def create(self, validated_data):
        invitees = validated_data.pop("invitees", [])
        event = super().create(validated_data)
        self._invite(event, invitees)
        return event

    def update(self, instance, validated_data):
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
