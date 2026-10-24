"""Reminders FireFirst sends on its own, once a day."""

import datetime

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.certifications.models import Certification
from apps.core.models import User

from .kinds import CERTIFICATION_REMINDER_DAYS
from .models import CertificationReminder
from .send import notify


def certification_reminders(today=None):
    """Remind members 60, 30 and 7 days before a certification expires (once each), and give each department's
    officers one summary of who was reminded."""
    today = today or timezone.localdate()
    horizon = today + datetime.timedelta(days=max(CERTIFICATION_REMINDER_DAYS))
    expiring = Certification.objects.filter(
        user__is_active=True, expires_on__gte=today, expires_on__lte=horizon
    ).select_related("user__department", "certification_type")
    by_department = {}
    for cert in expiring:
        days_left = (cert.expires_on - today).days
        # The nearest threshold already reached: a certificate found 5 days out gets the 7-day reminder only.
        threshold = min(d for d in CERTIFICATION_REMINDER_DAYS if days_left <= d)
        try:
            with transaction.atomic():
                CertificationReminder.objects.create(
                    department=cert.user.department,
                    certification=cert,
                    days_before=threshold,
                    expires_on=cert.expires_on,
                )
        except IntegrityError:
            continue  # Already sent.
        when = "today" if days_left == 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"
        notify(
            "certification_expiring",
            [cert.user],
            f"Your {cert.certification_type.name} expires {when}",
            f"Expires {cert.expires_on:%b} {cert.expires_on.day}, {cert.expires_on.year}. "
            "Renew it and update FireFirst.",
            "/certifications",
        )
        by_department.setdefault(cert.user.department, []).append((cert, days_left))

    for department, certs in by_department.items():
        officers = User.objects.filter(
            department=department, is_active=True, role__in=[User.Role.ADMIN, User.Role.OFFICER]
        )
        lines = [f"{c.user} · {c.certification_type.name} · {d} days" for c, d in sorted(certs, key=lambda x: x[1])]
        notify(
            "certification_expiring",
            officers,
            f"{len(certs)} certification{'s' if len(certs) != 1 else ''} expiring soon",
            "\n".join(lines),
            "/certifications",
        )
