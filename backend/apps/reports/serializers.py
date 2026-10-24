from rest_framework import serializers

from .models import ReportSchedule


class ReportScheduleSerializer(serializers.Serializer):
    report = serializers.CharField()
    label = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    weekly = serializers.BooleanField(read_only=True)
    enabled = serializers.BooleanField()
    send_at = serializers.TimeField()
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    audience = serializers.ChoiceField(choices=ReportSchedule.Audience.choices)
    extra_emails = serializers.CharField(allow_blank=True, required=False, default="")
    last_sent_on = serializers.DateField(read_only=True, allow_null=True)

    def validate_extra_emails(self, value):
        emails = [e.strip() for e in value.splitlines() if e.strip()]
        for email in emails:
            serializers.EmailField().run_validation(email)
        return "\n".join(emails)


class ReportPreviewSerializer(serializers.Serializer):
    subject = serializers.CharField()
    body = serializers.CharField()
