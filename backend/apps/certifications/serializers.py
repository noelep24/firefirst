from django.utils import timezone
from rest_framework import serializers

from apps.core.tenancy import TenantSerializer

from .models import Certification, CertificationType


class CertificationTypeSerializer(TenantSerializer):
    class Meta:
        model = CertificationType
        fields = ["id", "name", "code", "renewal_months", "required_for_all", "notes"]


class CertificationSerializer(TenantSerializer):
    user_name = serializers.CharField(source="user.__str__", read_only=True)
    type_name = serializers.CharField(source="certification_type.name", read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Certification
        fields = [
            "id",
            "user",
            "user_name",
            "certification_type",
            "type_name",
            "number",
            "issued_on",
            "expires_on",
            "status",
            "notes",
        ]
        extra_kwargs = {
            "expires_on": {"help_text": "Leave blank to use the type's renewal period, or if it doesn't expire"}
        }

    def get_status(self, obj) -> str:
        return obj.status_on(timezone.localdate())

    def validate(self, attrs):
        issued = attrs.get("issued_on", getattr(self.instance, "issued_on", None))
        expires = attrs.get("expires_on", getattr(self.instance, "expires_on", None))
        if issued and expires and expires < issued:
            raise serializers.ValidationError({"expires_on": "Expires before it was issued."})
        return attrs


class ComplianceItemSerializer(serializers.Serializer):
    certification_type = serializers.IntegerField()
    type_name = serializers.CharField()
    status = serializers.ChoiceField(choices=["valid", "expiring", "expired", "missing"])
    expires_on = serializers.DateField(allow_null=True)


class ComplianceSerializer(serializers.Serializer):
    user = serializers.IntegerField()
    name = serializers.CharField()
    problems = ComplianceItemSerializer(many=True, help_text="Required or held certifications that need attention")
