import calendar
import datetime

from django.conf import settings
from django.db import models

from apps.core.models import TenantModel

EXPIRING_SOON_DAYS = 60


def add_months(date, months):
    month = date.month - 1 + months
    year = date.year + month // 12
    month = month % 12 + 1
    return datetime.date(year, month, min(date.day, calendar.monthrange(year, month)[1]))


class CertificationType(TenantModel):
    """A credential the department tracks: EMT, Paramedic, Driver/Operator, Hazmat Ops, CPR…"""

    name = models.CharField(max_length=120)
    code = models.CharField(max_length=20, blank=True, help_text="Short label, e.g. EMT-B, FF2")
    renewal_months = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Fills in the expiration from the issue date when none is given"
    )
    required_for_all = models.BooleanField(default=False, help_text="Every active member must hold it")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["department", "name"], name="unique_certification_type")]

    def __str__(self):
        return self.code or self.name


class Certification(TenantModel):
    class Status(models.TextChoices):
        VALID = "valid", "Valid"
        EXPIRING = "expiring", "Expiring soon"
        EXPIRED = "expired", "Expired"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="certifications")
    certification_type = models.ForeignKey(CertificationType, on_delete=models.CASCADE, related_name="certifications")
    number = models.CharField("Certificate number", max_length=60, blank=True)
    issued_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True, help_text="Blank if it doesn't expire")
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["expires_on", "id"]

    def __str__(self):
        return f"{self.user} – {self.certification_type}"

    def save(self, *args, **kwargs):
        renewal = self.certification_type.renewal_months
        if self.expires_on is None and self.issued_on and renewal:
            self.expires_on = add_months(self.issued_on, renewal)
        super().save(*args, **kwargs)

    def status_on(self, date):
        if self.expires_on is None or self.expires_on >= date + datetime.timedelta(days=EXPIRING_SOON_DAYS):
            return self.Status.VALID
        if self.expires_on >= date:
            return self.Status.EXPIRING
        return self.Status.EXPIRED

    def is_valid_on(self, date):
        return (self.issued_on is None or self.issued_on <= date) and (
            self.expires_on is None or self.expires_on >= date
        )
