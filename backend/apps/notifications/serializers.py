from rest_framework import serializers

from .models import Notification, PushDevice


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "title", "body", "link", "read_at", "created_at"]
        read_only_fields = fields


class PushDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushDevice
        fields = ["token", "platform"]
        extra_kwargs = {"token": {"validators": []}}

    def validate_token(self, value):
        if not (value.startswith("ExponentPushToken[") or value.startswith("ExpoPushToken[")):
            raise serializers.ValidationError("Not an Expo push token.")
        return value


class ChannelRuleSerializer(serializers.Serializer):
    """One kind of notification and how it goes out."""

    kind = serializers.CharField()
    label = serializers.CharField(read_only=True)
    audience = serializers.CharField(read_only=True)
    required = serializers.BooleanField(read_only=True, help_text="Members can't turn it off")
    push = serializers.BooleanField()
    email = serializers.BooleanField()


class MyChannelSerializer(serializers.Serializer):
    """One kind of notification for the signed-in member: whether the department sends it by push and email, and
    whether they want it."""

    kind = serializers.CharField()
    label = serializers.CharField(read_only=True)
    required = serializers.BooleanField(read_only=True)
    department_push = serializers.BooleanField(read_only=True)
    department_email = serializers.BooleanField(read_only=True)
    push = serializers.BooleanField(help_text="The member wants it on their phone")
    email = serializers.BooleanField(help_text="The member wants it by email")
