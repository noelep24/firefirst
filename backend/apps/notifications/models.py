from django.conf import settings
from django.db import models

from apps.core.models import TenantModel


class Notification(TenantModel):
    """Something a member should know about: shown in the apps and, where they allow it, pushed to their phone."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=300, blank=True)
    link = models.CharField(max_length=200, blank=True, help_text="Where in the app this leads, e.g. /schedule")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read_at"])]

    def __str__(self):
        return self.title


class PushDevice(TenantModel):
    """A phone that has allowed FireFirst notifications, by its Expo push token."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_devices")
    token = models.CharField(max_length=200, unique=True)
    platform = models.CharField(max_length=20, blank=True)

    def __str__(self):
        return f"{self.user} ({self.platform or 'device'})"
