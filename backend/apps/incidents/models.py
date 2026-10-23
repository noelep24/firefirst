from django.conf import settings
from django.db import models

from apps.apparatus.models import Apparatus
from apps.core.models import Station, TenantModel


class Incident(TenantModel):
    """A call the department ran, reported in NERIS terms.

    Coded answers use NERIS value-set codes (see neris.py), so a report maps onto a NERIS submission without
    translation. Patient details stay in the department's ePCR (ESO): incidents only keep its report numbers.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        COMPLETE = "complete", "Complete"

    number = models.CharField(max_length=40, help_text="Department incident number, e.g. 2026-00123")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    alarm_at = models.DateTimeField(help_text="When the call came in")
    station = models.ForeignKey(Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    # Location (NERIS civic location, simplified to what crews actually write down).
    address = models.CharField(max_length=255, blank=True, help_text="Street address, e.g. 120 N Oak Ave")
    address_detail = models.CharField(max_length=255, blank=True, help_text="Apartment, floor, landmark…")
    city = models.CharField(max_length=120, blank=True)
    state = models.CharField(max_length=2, blank=True)
    postal_code = models.CharField(max_length=10, blank=True)

    incident_types = models.JSONField(default=list, blank=True, help_text="Up to 3 NERIS incident types, primary first")
    actions_taken = models.JSONField(default=list, blank=True, help_text="NERIS action/tactic codes")
    no_action_reason = models.CharField(max_length=40, blank=True, help_text="NERIS no-action code, if none taken")
    people_present = models.BooleanField(null=True, blank=True)
    displaced = models.PositiveIntegerField(null=True, blank=True, help_text="People displaced")
    rescues_or_casualties = models.BooleanField(
        null=True, blank=True, help_text="Any rescues, injuries or deaths (civilian or firefighter)"
    )
    fire = models.JSONField(default=dict, blank=True, help_text="NERIS fire module answers")
    alarms = models.JSONField(default=dict, blank=True, help_text="Smoke alarm, fire alarm and sprinkler presence")
    patients = models.JSONField(
        default=list, blank=True, help_text="One entry per patient: ESO report number + NERIS outcome"
    )
    narrative = models.TextField(blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-alarm_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["department", "number"], name="unique_incident_number")]

    def __str__(self):
        return f"Incident {self.number}"


class IncidentUnit(TenantModel):
    """A unit that responded, with its crew and times (NERIS unit response)."""

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="units")
    apparatus = models.ForeignKey(Apparatus, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    unit = models.CharField(max_length=30, help_text="Unit designation, e.g. E1 or a mutual-aid unit")
    response_mode = models.CharField(max_length=20, blank=True, help_text="NERIS response mode code")
    crew = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="+")
    staffing = models.PositiveSmallIntegerField(null=True, blank=True, help_text="People on the unit")
    dispatched_at = models.DateTimeField(null=True, blank=True)
    enroute_at = models.DateTimeField(null=True, blank=True)
    on_scene_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cleared_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.unit} on {self.incident}"
