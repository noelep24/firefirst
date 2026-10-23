import base64
import binascii
import re

from rest_framework import serializers

from .models import Department, Station, User
from .tenancy import TenantSerializer


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name", "slug", "timezone", "neris_id", "logo"]
        read_only_fields = ["slug"]

    LOGO_MAX_BYTES = 512 * 1024
    LOGO_PATTERN = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")

    def validate_logo(self, value):
        """PNG, JPEG or WebP only (no SVG, which can carry script), and small enough to send with every page."""
        if not value:
            return ""
        match = self.LOGO_PATTERN.match(value)
        if not match:
            raise serializers.ValidationError("Upload the logo as a PNG, JPEG or WebP image.")
        try:
            size = len(base64.b64decode(match.group(2), validate=True))
        except binascii.Error:
            raise serializers.ValidationError("That image couldn't be read. Try saving it again as a PNG.") from None
        if size > self.LOGO_MAX_BYTES:
            raise serializers.ValidationError("The logo must be 512 KB or smaller.")
        return value

    def validate_neris_id(self, value):
        value = value.strip().upper()
        if value and not (len(value) == 10 and value[:2].isalpha() and value[2:].isdigit()):
            raise serializers.ValidationError("A NERIS ID is 2 letters and 8 digits, e.g. FD12345678.")
        return value


class StationSerializer(TenantSerializer):
    class Meta:
        model = Station
        fields = ["id", "number", "name", "address", "phone"]


class UserSerializer(TenantSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    full_name = serializers.CharField(source="get_full_name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "phone",
            "employee_id",
            "rank",
            "role",
            "home_station",
            "is_active",
            "password",
        ]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


class MeSerializer(UserSerializer):
    department = DepartmentSerializer(read_only=True)

    class Meta(UserSerializer.Meta):
        fields = [f for f in UserSerializer.Meta.fields if f != "password"] + ["department"]
        # Members may edit their own contact details, never their role or status.
        read_only_fields = ["username", "role", "is_active", "employee_id", "rank", "home_station"]


class DashboardEventSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    category = serializers.CharField()
    starts_at = serializers.DateTimeField()
    is_mandatory = serializers.BooleanField()


class DashboardUnitSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    unit_number = serializers.CharField()


class DashboardSerializer(serializers.Serializer):
    date = serializers.DateField()
    platoon_on_duty = serializers.CharField(allow_null=True)
    apparatus_out_of_service = DashboardUnitSerializer(many=True)
    open_work_orders = serializers.IntegerField()
    maintenance_due = serializers.IntegerField()
    stock_below_par = serializers.IntegerField()
    stock_expiring_30_days = serializers.IntegerField()
    upcoming_events = DashboardEventSerializer(many=True)
    certifications_needing_attention = serializers.IntegerField(
        help_text="Expiring within 60 days or expired: department-wide for officers, your own for members"
    )
    staffing_shortfall_days = serializers.ListField(
        child=serializers.DateField(), help_text="Days in the next week whose crew misses a staffing rule"
    )
    pending_leave_requests = serializers.IntegerField(required=False, help_text="Officers only")
    pending_shift_trades = serializers.IntegerField(required=False, help_text="Officers only")
