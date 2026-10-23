from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import Station, TenantModel


class Apparatus(TenantModel):
    class Type(models.TextChoices):
        ENGINE = "engine", "Engine"
        LADDER = "ladder", "Ladder / Truck"
        QUINT = "quint", "Quint"
        RESCUE = "rescue", "Rescue / Squad"
        AMBULANCE = "ambulance", "Ambulance / Medic"
        BRUSH = "brush", "Brush"
        TENDER = "tender", "Tender / Tanker"
        HAZMAT = "hazmat", "Hazmat"
        COMMAND = "command", "Command / Staff"
        UTILITY = "utility", "Utility"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        IN_SERVICE = "in_service", "In service"
        LIMITED = "limited", "In service – limited"
        OUT_OF_SERVICE = "out_of_service", "Out of service"
        RESERVE = "reserve", "Reserve"

    unit_number = models.CharField(max_length=30)
    apparatus_type = models.CharField(max_length=20, choices=Type.choices)
    station = models.ForeignKey(Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="apparatus")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_SERVICE)
    make = models.CharField(max_length=80, blank=True)
    model = models.CharField(max_length=80, blank=True)
    year = models.PositiveSmallIntegerField(null=True, blank=True)
    vin = models.CharField("VIN", max_length=32, blank=True)
    license_plate = models.CharField(max_length=20, blank=True)
    mileage = models.PositiveIntegerField(default=0)
    engine_hours = models.DecimalField(max_digits=9, decimal_places=1, default=0)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["unit_number"]
        verbose_name_plural = "apparatus"
        constraints = [
            models.UniqueConstraint(fields=["department", "unit_number"], name="unique_unit_number"),
        ]

    def __str__(self):
        return self.unit_number

    def record_readings(self, mileage=None, engine_hours=None):
        """Advance odometer/hour meter. Readings never move backwards."""
        changed = []
        if mileage is not None and mileage > self.mileage:
            self.mileage = mileage
            changed.append("mileage")
        if engine_hours is not None and engine_hours > self.engine_hours:
            self.engine_hours = engine_hours
            changed.append("engine_hours")
        if changed:
            self.save(update_fields=changed + ["updated_at"])

    def refresh_status_from_work_orders(self):
        """Put the rig out of service while any OOS work order is open, and back in when none are."""
        has_oos = self.work_orders.filter(takes_out_of_service=True, status__in=WorkOrder.OPEN_STATUSES).exists()
        if has_oos and self.status != self.Status.OUT_OF_SERVICE:
            self.status = self.Status.OUT_OF_SERVICE
        elif not has_oos and self.status == self.Status.OUT_OF_SERVICE:
            self.status = self.Status.IN_SERVICE
        else:
            return
        self.save(update_fields=["status", "updated_at"])


class ChecklistTemplate(TenantModel):
    """A rig-check form, e.g. "Engine daily check" or "Weekly SCBA check"."""

    name = models.CharField(max_length=120)
    apparatus_type = models.CharField(
        max_length=20,
        choices=Apparatus.Type.choices,
        blank=True,
        help_text="Leave blank to offer this checklist for every apparatus type.",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ChecklistItem(models.Model):
    template = models.ForeignKey(ChecklistTemplate, on_delete=models.CASCADE, related_name="items")
    section = models.CharField(max_length=80, blank=True, help_text="e.g. Cab, Pump panel, Compartment 1")
    prompt = models.CharField(max_length=255)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.prompt


class Inspection(TenantModel):
    """A completed rig check."""

    apparatus = models.ForeignKey(Apparatus, on_delete=models.CASCADE, related_name="inspections")
    template = models.ForeignKey(ChecklistTemplate, on_delete=models.RESTRICT, related_name="inspections")
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT, related_name="inspections")
    performed_at = models.DateTimeField(default=timezone.now)
    mileage = models.PositiveIntegerField(null=True, blank=True)
    engine_hours = models.DecimalField(max_digits=9, decimal_places=1, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-performed_at"]

    def __str__(self):
        return f"{self.apparatus} – {self.template} – {self.performed_at:%Y-%m-%d}"

    @property
    def deficiency_count(self):
        return sum(1 for r in self.results.all() if r.status == InspectionResult.Status.DEFICIENT)


class InspectionResult(models.Model):
    class Status(models.TextChoices):
        OK = "ok", "OK"
        DEFICIENT = "deficient", "Deficient"
        NOT_APPLICABLE = "na", "N/A"

    inspection = models.ForeignKey(Inspection, on_delete=models.CASCADE, related_name="results")
    checklist_item = models.ForeignKey(ChecklistItem, on_delete=models.RESTRICT, related_name="+")
    status = models.CharField(max_length=12, choices=Status.choices)
    note = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["inspection", "checklist_item"], name="unique_result_per_item"),
        ]


class WorkOrder(TenantModel):
    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        IN_PROGRESS = "in_progress", "In progress"
        WAITING_PARTS = "waiting_parts", "Waiting on parts"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    OPEN_STATUSES = [Status.OPEN, Status.IN_PROGRESS, Status.WAITING_PARTS]

    apparatus = models.ForeignKey(Apparatus, on_delete=models.CASCADE, related_name="work_orders")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    takes_out_of_service = models.BooleanField(
        default=False, help_text="While open, the apparatus is marked out of service."
    )
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="reported_work_orders"
    )
    assigned_to = models.CharField(max_length=120, blank=True, help_text="Mechanic, shop or vendor")
    source_inspection = models.ForeignKey(
        Inspection, null=True, blank=True, on_delete=models.SET_NULL, related_name="work_orders"
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    resolution = models.TextField(blank=True)
    cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.apparatus}: {self.title}"

    @property
    def is_open(self):
        return self.status in self.OPEN_STATUSES

    def save(self, *args, **kwargs):
        if self.status == self.Status.COMPLETED and self.completed_at is None:
            self.completed_at = timezone.now()
        super().save(*args, **kwargs)
        self.apparatus.refresh_status_from_work_orders()


class MaintenanceSchedule(TenantModel):
    """Recurring preventive maintenance or testing, due by date, mileage or engine hours.

    Typical entries: oil change, annual pump test, ladder test, aerial
    inspection, DOT inspection.
    """

    apparatus = models.ForeignKey(Apparatus, on_delete=models.CASCADE, related_name="maintenance_schedules")
    task = models.CharField(max_length=160)
    interval_days = models.PositiveIntegerField(null=True, blank=True)
    interval_miles = models.PositiveIntegerField(null=True, blank=True)
    interval_hours = models.DecimalField(max_digits=8, decimal_places=1, null=True, blank=True)
    last_performed_on = models.DateField(null=True, blank=True)
    last_mileage = models.PositiveIntegerField(null=True, blank=True)
    last_engine_hours = models.DecimalField(max_digits=9, decimal_places=1, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["apparatus__unit_number", "task"]

    def __str__(self):
        return f"{self.apparatus}: {self.task}"

    @property
    def next_due_date(self):
        if self.interval_days and self.last_performed_on:
            return self.last_performed_on + timedelta(days=self.interval_days)
        return None

    @property
    def next_due_mileage(self):
        if self.interval_miles and self.last_mileage is not None:
            return self.last_mileage + self.interval_miles
        return None

    @property
    def next_due_engine_hours(self):
        if self.interval_hours and self.last_engine_hours is not None:
            return self.last_engine_hours + self.interval_hours
        return None

    def is_due(self, on_date=None, warning_days=0):
        """Due if never performed, or any interval has been reached (with an optional lead time)."""
        if self.last_performed_on is None:
            return True
        on_date = on_date or timezone.localdate()
        due_date = self.next_due_date
        if due_date and due_date <= on_date + timedelta(days=warning_days):
            return True
        due_miles = self.next_due_mileage
        if due_miles is not None and self.apparatus.mileage >= due_miles:
            return True
        due_hours = self.next_due_engine_hours
        if due_hours is not None and self.apparatus.engine_hours >= due_hours:
            return True
        return False


class ServiceRecord(TenantModel):
    """Maintenance that was performed. Logging one against a schedule resets that schedule."""

    apparatus = models.ForeignKey(Apparatus, on_delete=models.CASCADE, related_name="service_records")
    schedule = models.ForeignKey(
        MaintenanceSchedule, null=True, blank=True, on_delete=models.SET_NULL, related_name="records"
    )
    description = models.CharField(max_length=255)
    performed_on = models.DateField(default=timezone.localdate)
    performed_by = models.CharField(max_length=120, blank=True, help_text="Mechanic, shop or vendor")
    mileage = models.PositiveIntegerField(null=True, blank=True)
    engine_hours = models.DecimalField(max_digits=9, decimal_places=1, null=True, blank=True)
    cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True, help_text="For tests such as pump or ladder tests")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-performed_on", "-id"]

    def __str__(self):
        return f"{self.apparatus}: {self.description} ({self.performed_on})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.apparatus.record_readings(self.mileage, self.engine_hours)
        schedule = self.schedule
        if schedule and (schedule.last_performed_on is None or self.performed_on >= schedule.last_performed_on):
            schedule.last_performed_on = self.performed_on
            schedule.last_mileage = self.mileage if self.mileage is not None else self.apparatus.mileage
            schedule.last_engine_hours = (
                self.engine_hours if self.engine_hours is not None else self.apparatus.engine_hours
            )
            schedule.save(update_fields=["last_performed_on", "last_mileage", "last_engine_hours", "updated_at"])


class ApparatusMove(TenantModel):
    """A rig temporarily at another station, e.g. a reserve engine covering while a frontline rig is in the
    shop. The rig's ``station`` stays its home; while a move is active it counts as being at ``station``.
    Permanent moves just change ``Apparatus.station``."""

    apparatus = models.ForeignKey(Apparatus, on_delete=models.CASCADE, related_name="moves")
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name="+")
    starts_on = models.DateField()
    ends_on = models.DateField(null=True, blank=True, help_text="Last day away; blank until it's returned")
    returned_at = models.DateTimeField(null=True, blank=True)
    covering_for = models.ForeignKey(
        Apparatus,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="A rig out of service whose crew rides this one meanwhile",
    )
    crew_moves = models.BooleanField(
        default=False, help_text="The rig's own crew goes with it (otherwise they stay at their station)"
    )
    reason = models.CharField(max_length=200, blank=True)
    moved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-starts_on", "-id"]

    def __str__(self):
        return f"{self.apparatus} → {self.station}"

    def is_active_on(self, date):
        if self.starts_on > date or (self.ends_on and self.ends_on < date):
            return False
        return not (self.returned_at and timezone.localdate(self.returned_at) <= date)

    @classmethod
    def active_on(cls, department, date):
        """The move in effect for each rig on ``date``, by apparatus id."""
        moves = (
            cls.objects.filter(department=department, starts_on__lte=date)
            .filter(models.Q(ends_on__isnull=True) | models.Q(ends_on__gte=date))
            .select_related("apparatus", "station", "covering_for")
        )
        return {m.apparatus_id: m for m in moves if m.is_active_on(date)}
