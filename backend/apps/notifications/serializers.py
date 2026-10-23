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
