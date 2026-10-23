from django.conf import settings
from django.db import models

from apps.core.models import Station, TenantModel


class Event(TenantModel):
    class Category(models.TextChoices):
        TRAINING = "training", "Training"
        DRILL = "drill", "Drill"
        MEETING = "meeting", "Meeting"
        INSPECTION = "inspection", "Inspection / pre-plan"
        PUBLIC_ED = "public_ed", "Public education"
        COMMUNITY = "community", "Community event"
        MAINTENANCE = "maintenance", "Maintenance / station duty"
        OTHER = "other", "Other"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    station = models.ForeignKey(
        Station,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
        help_text="Leave blank for department-wide events",
    )
    location = models.CharField(max_length=200, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    all_day = models.BooleanField(default=False)
    is_mandatory = models.BooleanField(default=False)
    training_hours = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Credit hours awarded to attendees (training and drills)",
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    # Occurrences of a repeating event share a series id; each is a full event with its own attendance.
    series = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["starts_at"]

    def __str__(self):
        return f"{self.title} ({self.starts_at:%Y-%m-%d})"


class Attendance(models.Model):
    class Status(models.TextChoices):
        INVITED = "invited", "Invited"
        GOING = "going", "Going"
        DECLINED = "declined", "Declined"
        ATTENDED = "attended", "Attended"
        ABSENT = "absent", "Absent"

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="attendance")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_attendance")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.INVITED)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["event", "user"], name="unique_attendance")]

    def __str__(self):
        return f"{self.user} – {self.event}: {self.status}"
