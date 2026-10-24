"""Filling a vacancy with overtime, automatically.

1. A vacancy opens (an officer posts it, or leave is approved for someone on duty).
2. If the department offers voluntary overtime first, everyone available on that vacancy's overtime list is
   offered it and has the department's response time to answer.
3. When everyone has answered, or time is up, the volunteer highest on the list is hired. With no volunteers
   (or no voluntary round), the next member up on the list is hired as mandatory overtime.
4. If no one is available, the officers are told the seat is still open.

Deadlines are acted on whenever someone looks at overtime (``process_due``) and by the ``process_overtime``
management command, which a scheduler can run every few minutes.
"""

import datetime
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from apps.core.models import User
from apps.notifications.send import notify

from .models import Assignment, OvertimeOffer, OvertimeSettings, OvertimeShift, Vacancy
from .overtime import list_for, overtime_list
from .roster import platoon_on

MAX_LEAVE_VACANCY_DAYS = 31
LINK = "/schedule?tab=overtime"


def open_vacancy(vacancy, now=None):
    """Start filling a new vacancy: offer it to volunteers, or hire straight off the list."""
    now = now or timezone.now()
    rules = OvertimeSettings.for_department(vacancy.department)
    if rules.voluntary_first:
        candidates = available(vacancy)
        if candidates:
            vacancy.status = Vacancy.Status.OFFERED
            vacancy.respond_by = now + datetime.timedelta(hours=rules.response_hours)
            vacancy.save(update_fields=["status", "respond_by", "updated_at"])
            OvertimeOffer.objects.bulk_create(
                [OvertimeOffer(department=vacancy.department, vacancy=vacancy, user_id=m["user"]) for m in candidates]
            )
            users = User.objects.filter(id__in=[m["user"] for m in candidates])
            notify(
                "overtime_offer",
                users,
                f"Overtime available {_day(vacancy.date)}",
                f"{describe(vacancy)}. Answer by {_time(vacancy, vacancy.respond_by)}.",
                LINK,
            )
            return vacancy
    _hire_from_list(vacancy)
    return vacancy


def respond(offer, accept, now=None):
    """A member volunteers for, or turns down, an offer. Closes the vacancy early once everyone has answered."""
    offer.status = OvertimeOffer.Status.ACCEPTED if accept else OvertimeOffer.Status.DECLINED
    offer.responded_at = now or timezone.now()
    offer.save(update_fields=["status", "responded_at", "updated_at"])
    if not offer.vacancy.offers.filter(status=OvertimeOffer.Status.PENDING).exists():
        resolve(offer.vacancy)
    return offer


def resolve(vacancy):
    """Close volunteering: hire the volunteer highest on the list, or hire off the list."""
    with transaction.atomic():
        vacancy = Vacancy.objects.select_for_update().get(pk=vacancy.pk)
        if vacancy.status != Vacancy.Status.OFFERED:
            return vacancy
        vacancy.offers.filter(status=OvertimeOffer.Status.PENDING).update(
            status=OvertimeOffer.Status.EXPIRED, updated_at=timezone.now()
        )
        volunteers = set(vacancy.offers.filter(status=OvertimeOffer.Status.ACCEPTED).values_list("user_id", flat=True))
        pick = next((m["user"] for m in available(vacancy) if m["user"] in volunteers), None)
        if pick:
            hire(vacancy, User.objects.get(pk=pick), mandatory=False)
        else:
            _hire_from_list(vacancy)
    return vacancy


def hire(vacancy, user, mandatory, by=None):
    """Put ``user`` in the seat: record the overtime and close the vacancy."""
    shift = OvertimeShift.objects.create(
        department=vacancy.department,
        user=user,
        date=vacancy.date,
        hours=vacancy.hours,
        filling_for=vacancy.filling_for,
        station=vacancy.station if vacancy.filling_for is None else None,
        mandatory=mandatory,
        note=vacancy.note,
        recorded_by=by,
    )
    vacancy.status = Vacancy.Status.FILLED
    vacancy.overtime_shift = shift
    vacancy.save(update_fields=["status", "overtime_shift", "updated_at"])
    vacancy.offers.exclude(user=user).filter(
        status__in=[OvertimeOffer.Status.PENDING, OvertimeOffer.Status.ACCEPTED]
    ).update(status=OvertimeOffer.Status.WITHDRAWN, updated_at=timezone.now())
    kind = "mandatory overtime" if mandatory else "overtime"
    notify(
        "overtime_mandatory" if mandatory else "overtime_voluntary",
        [user],
        f"You're working {kind} {_day(vacancy.date)}",
        describe(vacancy),
        LINK,
    )
    if vacancy.created_by and vacancy.created_by != by:
        notify(
            "vacancy_filled",
            [vacancy.created_by],
            f"Vacancy filled {_day(vacancy.date)}",
            f"{user} · {describe(vacancy)}",
            LINK,
        )
    return shift


def cancel(vacancy):
    """Take a vacancy back (the seat no longer needs filling). Anyone offered it is told."""
    if vacancy.status != Vacancy.Status.OFFERED:
        vacancy.status = Vacancy.Status.CANCELLED
        vacancy.save(update_fields=["status", "updated_at"])
        return vacancy
    waiting = User.objects.filter(
        overtime_offers__vacancy=vacancy,
        overtime_offers__status__in=[OvertimeOffer.Status.PENDING, OvertimeOffer.Status.ACCEPTED],
    )
    notify("overtime_withdrawn", waiting, f"Overtime no longer needed {_day(vacancy.date)}", describe(vacancy), LINK)
    vacancy.offers.filter(status__in=[OvertimeOffer.Status.PENDING, OvertimeOffer.Status.ACCEPTED]).update(
        status=OvertimeOffer.Status.WITHDRAWN, updated_at=timezone.now()
    )
    vacancy.status = Vacancy.Status.CANCELLED
    vacancy.save(update_fields=["status", "updated_at"])
    return vacancy


def process_due(department=None, now=None):
    """Close volunteering on every vacancy whose answer time has passed."""
    now = now or timezone.now()
    due = Vacancy.objects.filter(status=Vacancy.Status.OFFERED, respond_by__lte=now)
    if department is not None:
        due = due.filter(department=department)
    for vacancy in due:
        resolve(vacancy)


def vacancies_for_leave(leave, by=None):
    """Open a vacancy for each shift an approved leave takes the member off, if the department wants that."""
    if not OvertimeSettings.for_department(leave.department).vacancy_from_leave:
        return []
    assignment = Assignment.objects.filter(user=leave.user).select_related("platoon").first()
    if assignment is None or list_for(assignment.position) is None:
        return []
    today = timezone.localdate()
    day, opened = max(leave.start_date, today), []
    last = min(leave.end_date, today + datetime.timedelta(days=MAX_LEAVE_VACANCY_DAYS))
    while day <= last:
        if platoon_on(leave.department, day) == assignment.platoon.code:
            vacancy = Vacancy.objects.create(
                department=leave.department,
                date=day,
                overtime_list=list_for(assignment.position),
                position=assignment.position,
                station=assignment.station,
                filling_for=leave.user,
                leave_request=leave,
                created_by=by,
                note=f"{leave.get_leave_type_display()} for {leave.user}",
            )
            opened.append(open_vacancy(vacancy))
        day += datetime.timedelta(days=1)
    return opened


def cancel_for_leave(leave):
    """Leave was cancelled: stop filling the seats it opened (filled ones stay for an officer to sort out)."""
    for vacancy in leave.vacancies.filter(status__in=[Vacancy.Status.OFFERED, Vacancy.Status.UNFILLED]):
        cancel(vacancy)


def describe(vacancy):
    seat = Assignment.Position(vacancy.position).label if vacancy.position else vacancy.get_overtime_list_display()
    parts = [f"{seat} seat" if vacancy.position else seat]
    if vacancy.filling_for:
        parts.append(f"filling for {vacancy.filling_for}")
    if vacancy.station:
        parts.append(str(vacancy.station))
    return " · ".join(parts)


def available(vacancy):
    """Members on the vacancy's list who could work it, in list order."""
    board = overtime_list(vacancy.department, vacancy.date)
    members = next(lst["members"] for lst in board["lists"] if lst["key"] == vacancy.overtime_list)
    return [m for m in members if m["status"] == "available" and m["user"] != vacancy.filling_for_id]


def _hire_from_list(vacancy):
    candidates = available(vacancy)
    if candidates:
        hire(vacancy, User.objects.get(pk=candidates[0]["user"]), mandatory=True)
        return
    vacancy.status = Vacancy.Status.UNFILLED
    vacancy.save(update_fields=["status", "updated_at"])
    officers = User.objects.filter(
        department=vacancy.department, is_active=True, role__in=[User.Role.ADMIN, User.Role.OFFICER]
    )
    notify(
        "vacancy_unfilled",
        officers,
        f"Vacancy still open {_day(vacancy.date)}",
        f"No one is available. {describe(vacancy)}",
        LINK,
    )


def _day(date):
    return f"{date:%a %b} {date.day}"


def _time(vacancy, moment):
    local = timezone.localtime(moment, ZoneInfo(vacancy.department.timezone))
    return f"{local:%I:%M %p}".lstrip("0") + (f" {_day(local.date())}" if local.date() != timezone.localdate() else "")
