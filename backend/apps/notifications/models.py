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


class NotificationRule(TenantModel):
    """How a department sends one kind of notification. Missing rows mean the kind's defaults."""

    kind = models.CharField(max_length=40)
    push = models.BooleanField(default=True)
    email = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["department", "kind"], name="one_rule_per_kind")]

    def __str__(self):
        return f"{self.kind}: push={self.push} email={self.email}"


class NotificationOptOut(TenantModel):
    """A member turning off push or email for a kind of notification they don't need."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_opt_outs")
    kind = models.CharField(max_length=40)
    push = models.BooleanField(default=False, help_text="Turned off phone notifications")
    email = models.BooleanField(default=False, help_text="Turned off email")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "kind"], name="one_opt_out_per_kind")]

    def __str__(self):
        return f"{self.user} {self.kind}"


class CertificationReminder(TenantModel):
    """A reminder already sent, so each one goes out once."""

    certification = models.ForeignKey(
        "certifications.Certification", on_delete=models.CASCADE, related_name="reminders"
    )
    days_before = models.PositiveSmallIntegerField()
    expires_on = models.DateField(help_text="The expiry it was about; renewing starts the reminders over")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["certification", "days_before", "expires_on"], name="one_reminder_per_threshold"
            )
        ]
