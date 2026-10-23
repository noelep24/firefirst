import datetime

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import Station, TenantModel


class Platoon(TenantModel):
    """A shift group, e.g. A, B or C shift."""

    code = models.CharField(max_length=10, help_text="Short code used in rotation patterns, e.g. A")
    name = models.CharField(max_length=60, blank=True)
    color = models.CharField(max_length=7, default="#c62828", help_text="Hex color for calendars")

    class Meta:
        ordering = ["code"]
        constraints = [models.UniqueConstraint(fields=["department", "code"], name="unique_platoon_code")]

    def __str__(self):
        return self.name or f"{self.code} Shift"


class RotationPattern(TenantModel):
    """Repeating platoon rotation.

    ``sequence`` lists the platoon code on duty for each shift period starting
    at ``anchor_date``. A 24/48 is ``["A", "B", "C"]``; a 48/96 is
    ``["A", "A", "B", "B", "C", "C"]``; a Kelly schedule or a California
    swing is just a longer sequence.
    """

    name = models.CharField(max_length=80)
    anchor_date = models.DateField(help_text="A date on which the first platoon in the sequence works")
    sequence = models.JSONField(help_text='Platoon codes, one per day, e.g. ["A", "B", "C"]')
    shift_start = models.TimeField(default=datetime.time(7, 0))
    shift_hours = models.PositiveSmallIntegerField(default=24)
    is_active = models.BooleanField(default=True, help_text="Only one pattern is active per department")

    class Meta:
        ordering = ["-is_active", "name"]

    def __str__(self):
        return self.name

    def clean(self):
        if not isinstance(self.sequence, list) or not self.sequence:
            raise ValidationError({"sequence": "Enter at least one platoon code."})
        known = set(Platoon.objects.filter(department_id=self.department_id).values_list("code", flat=True))
        unknown = sorted(set(self.sequence) - known)
        if unknown:
            raise ValidationError({"sequence": f"Unknown platoon codes: {', '.join(unknown)}"})

    def platoon_code_on(self, date):
        return self.sequence[(date - self.anchor_date).days % len(self.sequence)]

    @classmethod
    def active_for(cls, department):
        return cls.objects.filter(department=department, is_active=True).first()


class Assignment(TenantModel):
    """A member's standing platoon, station and riding position."""

    class Position(models.TextChoices):
        CHIEF = "chief", "Battalion / Shift chief"
        CAPTAIN = "captain", "Captain"
        LIEUTENANT = "lieutenant", "Lieutenant"
        ENGINEER = "engineer", "Engineer / Driver-operator"
        FIREFIGHTER = "firefighter", "Firefighter"
        PARAMEDIC = "paramedic", "Paramedic"
        EMT = "emt", "EMT"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assignment")
    platoon = models.ForeignKey(Platoon, on_delete=models.RESTRICT, related_name="assignments")
    station = models.ForeignKey(Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="assignments")
    position = models.CharField(max_length=20, choices=Position.choices, default=Position.FIREFIGHTER)

    class Meta:
        ordering = ["platoon__code", "station__number"]

    def __str__(self):
        return f"{self.user} – {self.platoon} / {self.station or 'unassigned'}"


class LeaveRequest(TenantModel):
    class LeaveType(models.TextChoices):
        VACATION = "vacation", "Vacation"
        SICK = "sick", "Sick"
        PERSONAL = "personal", "Personal"
        KELLY = "kelly", "Kelly day"
        TRAINING = "training", "Training / detail"
        BEREAVEMENT = "bereavement", "Bereavement"
        INJURY = "injury", "On-duty injury"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        DENIED = "denied", "Denied"
        CANCELLED = "cancelled", "Cancelled"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.CharField(max_length=20, choices=LeaveType.choices)
    start_date = models.DateField()
    end_date = models.DateField()
    hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.user}: {self.get_leave_type_display()} {self.start_date}–{self.end_date}"


class ShiftTrade(TenantModel):
    """A member trading a shift to another member, who works it in their place.

    Flow: requester submits → covering member accepts → officer approves.
    """

    class Status(models.TextChoices):
        PENDING_PARTNER = "pending_partner", "Waiting on covering member"
        PENDING_APPROVAL = "pending_approval", "Waiting on officer approval"
        APPROVED = "approved", "Approved"
        DENIED = "denied", "Denied"
        DECLINED = "declined", "Declined by covering member"
        CANCELLED = "cancelled", "Cancelled"

    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trades_requested")
    covering_member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trades_covering"
    )
    shift_date = models.DateField()
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_PARTNER)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-shift_date"]

    def __str__(self):
        return f"{self.covering_member} covering {self.requester} on {self.shift_date}"
