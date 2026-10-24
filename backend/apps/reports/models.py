import datetime

from django.db import models

from apps.core.models import TenantModel


class ReportSchedule(TenantModel):
    """A report the department has emailed on a schedule, and to whom."""

    class Audience(models.TextChoices):
        OFFICERS = "officers", "Officers and admins"
        ADMINS = "admins", "Admins only"
        NOBODY = "nobody", "Only the extra addresses"

    report = models.CharField(max_length=40)
    enabled = models.BooleanField(default=False)
    send_at = models.TimeField(default=datetime.time(6, 30), help_text="Local time it goes out")
    weekday = models.PositiveSmallIntegerField(default=0, help_text="Weekly reports: 0 is Monday")
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.OFFICERS)
    extra_emails = models.TextField(blank=True, help_text="More addresses, one per line (a city manager, say)")
    last_sent_on = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["department", "report"], name="one_schedule_per_report")]

    def __str__(self):
        return f"{self.report} for {self.department}"
