"""Reports FireFirst emails on a schedule: the officers' morning briefing and a weekly overtime summary.

Each builder returns a subject and a plain-text body, short enough to read on a phone at shift change.
``send_due`` sends whatever is due; the ``send_reports`` command runs it every 15 minutes.
"""

import datetime
from dataclasses import dataclass
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import F, Sum
from django.utils import timezone

from apps.apparatus.models import Apparatus, MaintenanceSchedule, WorkOrder
from apps.certifications.models import Certification
from apps.core.models import User
from apps.events.models import Event
from apps.inventory.models import StockLevel
from apps.scheduling.models import LeaveRequest, OvertimeShift, ShiftTrade, Vacancy
from apps.scheduling.offers import describe
from apps.scheduling.roster import build_roster

from .models import ReportSchedule


def _day(date):
    return f"{date:%a %b} {date.day}"


def _hours(value):
    """24, 12.5 – not 24.00."""
    return f"{value.normalize():f}" if isinstance(value, Decimal) else f"{value:g}"


def _section(title, lines, empty):
    return [title.upper(), *(f"  • {line}" for line in lines)] if lines else [title.upper(), f"  {empty}"]


def morning_briefing(department, date):
    """Who's on, what's short, and what needs doing today."""
    roster = build_roster(department, date)
    body = []

    # Staffing, station by station.
    stations = {}
    for person in roster["working"]:
        stations.setdefault(person["station_number"] or "—", []).append(person)
    staffing = []
    for number, people in sorted(stations.items()):
        on_overtime = sum(1 for p in people if p.get("overtime"))
        staffing.append(
            f"Station {number}: {len(people)} on duty" + (f" ({on_overtime} on overtime)" if on_overtime else "")
        )
    staffing += [f"SHORT: {s['description']} (have {s['scheduled']})" for s in roster["shortfalls"]]
    staffing += [f"On leave: {p['name']}" for p in roster["on_leave"]]
    staffing += [f"Traded off: {p['name']}" for p in roster["traded_off"]]
    body += _section("Staffing", staffing, "No rotation set up.")

    hired = OvertimeShift.objects.filter(department=department, date=date).select_related("user", "filling_for")
    open_seats = Vacancy.objects.filter(
        department=department,
        status__in=[Vacancy.Status.OFFERED, Vacancy.Status.UNFILLED],
        date__gte=date,
        date__lte=date + datetime.timedelta(days=3),
    ).select_related("filling_for", "station")
    overtime = [
        f"{o.user}{' (mandatory)' if o.mandatory else ''}" + (f" for {o.filling_for}" if o.filling_for else "")
        for o in hired
    ]
    overtime += [
        f"OPEN {_day(v.date)}: {describe(v)}" + (" — no one available" if v.status == Vacancy.Status.UNFILLED else "")
        for v in open_seats
    ]
    body += [""] + _section("Overtime", overtime, "No overtime today and no open vacancies.")

    rigs = Apparatus.objects.filter(department=department)
    out = [f"{r.unit_number} out of service" for r in rigs.filter(status=Apparatus.Status.OUT_OF_SERVICE)]
    urgent = WorkOrder.objects.filter(
        department=department,
        status__in=WorkOrder.OPEN_STATUSES,
        priority__in=[WorkOrder.Priority.HIGH, WorkOrder.Priority.CRITICAL],
    ).select_related("apparatus")
    out += [f"{w.apparatus.unit_number}: {w.title} ({w.get_priority_display().lower()})" for w in urgent]
    due = [
        s
        for s in MaintenanceSchedule.objects.filter(department=department).select_related("apparatus")
        if s.is_due(on_date=date, warning_days=7)
    ]
    out += [
        f"{s.apparatus.unit_number}: {s.task} due "
        + (_day(s.next_due_date) if s.next_due_date and s.next_due_date > date else "now")
        for s in due
    ]
    body += [""] + _section("Apparatus", out, "All rigs in service. Nothing due.")

    waiting = []
    leave = LeaveRequest.objects.filter(department=department, status=LeaveRequest.Status.PENDING).count()
    trades = ShiftTrade.objects.filter(department=department, status=ShiftTrade.Status.PENDING_APPROVAL).count()
    if leave:
        waiting.append(f"{leave} leave request{'s' if leave != 1 else ''} to approve")
    if trades:
        waiting.append(f"{trades} shift trade{'s' if trades != 1 else ''} to approve")
    body += [""] + _section("Waiting for an officer", waiting, "Nothing waiting.")

    tz = ZoneInfo(department.timezone)
    start = datetime.datetime.combine(date, datetime.time.min, tz)
    events = Event.objects.filter(
        department=department, starts_at__lt=start + datetime.timedelta(days=1), ends_at__gt=start
    ).order_by("starts_at")
    today = [
        f"{timezone.localtime(e.starts_at, tz):%H:%M} {e.title}" + (" (mandatory)" if e.is_mandatory else "")
        for e in events
    ]
    expiring = Certification.objects.filter(
        department=department,
        user__is_active=True,
        expires_on__gte=date,
        expires_on__lte=date + datetime.timedelta(days=30),
    ).select_related("user", "certification_type")
    today += [f"{c.user}: {c.certification_type.name} expires {_day(c.expires_on)}" for c in expiring]
    body += [""] + _section("Training", today, "Nothing scheduled.")

    stock = StockLevel.objects.filter(department=department)
    low = stock.filter(quantity__lt=F("par_level")).count()
    expiring_stock = stock.filter(quantity__gt=0, expires_on__lte=date + datetime.timedelta(days=30)).count()
    supplies = []
    if low:
        supplies.append(f"{low} item{'s' if low != 1 else ''} below par")
    if expiring_stock:
        supplies.append(f"{expiring_stock} expiring within 30 days")
    body += [""] + _section("Supplies", supplies, "Stocked.")

    shift = f" · {roster['platoon']} Shift on duty" if roster["platoon"] else ""
    return f"Morning briefing: {_day(date)}{shift}", "\n".join(body)


def weekly_overtime(department, date):
    """The past seven days of overtime, and the week ahead."""
    start = date - datetime.timedelta(days=7)
    shifts = OvertimeShift.objects.filter(department=department, date__gte=start, date__lt=date)
    hours = shifts.aggregate(total=Sum("hours"))["total"] or Decimal(0)
    mandatory = shifts.filter(mandatory=True).count()
    body = _section(
        f"Overtime {_day(start)} – {_day(date - datetime.timedelta(days=1))}",
        [
            f"{shifts.count()} shifts, {_hours(hours)} hours "
            f"({mandatory} mandatory, {shifts.count() - mandatory} volunteered)"
        ]
        + [
            f"{row['user__first_name']} {row['user__last_name']}".strip() + f": {_hours(row['hours'])} hours"
            for row in shifts.values("user__first_name", "user__last_name")
            .annotate(hours=Sum("hours"))
            .order_by("-hours", "user__last_name")
        ]
        if shifts.exists()
        else [],
        "No overtime worked.",
    )
    vacancies = Vacancy.objects.filter(department=department, date__gte=start, date__lt=date)
    unfilled = vacancies.filter(status=Vacancy.Status.UNFILLED).count()
    if vacancies.exists():
        body += ["", f"Vacancies: {vacancies.count()} posted, {unfilled} nobody could fill"]

    ahead = [date + datetime.timedelta(days=n) for n in range(7)]
    short = [d for d in ahead if build_roster(department, d)["shortfalls"]]
    body += [""] + _section(
        "Week ahead", [f"{_day(d)}: below minimum staffing" for d in short], "Every day meets minimum staffing."
    )
    return f"Weekly overtime summary: week ending {_day(date - datetime.timedelta(days=1))}", "\n".join(body)


@dataclass(frozen=True)
class ScheduledReport:
    key: str
    label: str
    description: str
    weekly: bool
    build: callable


REPORTS = [
    ScheduledReport(
        "morning_briefing",
        "Morning briefing",
        "Each day: who's on, staffing gaps, open vacancies, rigs out of service, what's due and waiting.",
        False,
        morning_briefing,
    ),
    ScheduledReport(
        "weekly_overtime",
        "Weekly overtime summary",
        "Once a week: overtime hours by member, vacancies, and short-staffed days ahead.",
        True,
        weekly_overtime,
    ),
]
BY_KEY = {r.key: r for r in REPORTS}


def schedule_for(department, key):
    return ReportSchedule.objects.get_or_create(department=department, report=key)[0]


def recipients(schedule):
    roles = {
        ReportSchedule.Audience.OFFICERS: [User.Role.ADMIN, User.Role.OFFICER],
        ReportSchedule.Audience.ADMINS: [User.Role.ADMIN],
        ReportSchedule.Audience.NOBODY: [],
    }[schedule.audience]
    emails = list(
        User.objects.filter(department=schedule.department, is_active=True, role__in=roles)
        .exclude(email="")
        .values_list("email", flat=True)
    )
    emails += [e.strip() for e in schedule.extra_emails.splitlines() if e.strip()]
    return sorted(set(emails))


def send(schedule, date, to=None):
    """Build and email one report. ``to`` overrides the recipients (for a test send)."""
    subject, body = BY_KEY[schedule.report].build(schedule.department, date)
    footer = f"\n\n—\nOpen FireFirst: {settings.APP_URL}\nChange or stop this report in Settings › Reports.\n"
    addresses = to or recipients(schedule)
    if addresses:
        send_mail(f"{schedule.department.name}: {subject}", body + footer, None, addresses)
    return subject, body


def send_due(now=None):
    """Send every enabled report whose time has come today and hasn't gone out yet."""
    now = now or timezone.now()
    for schedule in ReportSchedule.objects.filter(enabled=True).select_related("department"):
        local = timezone.localtime(now, ZoneInfo(schedule.department.timezone))
        report = BY_KEY.get(schedule.report)
        if report is None or schedule.last_sent_on == local.date() or local.time() < schedule.send_at:
            continue
        if report.weekly and local.weekday() != schedule.weekday:
            continue
        send(schedule, local.date())
        schedule.last_sent_on = local.date()
        schedule.save(update_fields=["last_sent_on", "updated_at"])
