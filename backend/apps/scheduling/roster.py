"""Who is working on a given day."""

import datetime

from django.db import models

from apps.certifications.models import Certification

from .models import Assignment, LeaveRequest, RotationPattern, ShiftTrade, StaffingRule


def platoon_on(department, date):
    pattern = RotationPattern.active_for(department)
    return pattern.platoon_code_on(date) if pattern else None


def build_roster(department, date, assume_on_leave=frozenset()):
    """Return the on-duty platoon plus who is working, off on leave, covering trades, and staffing shortfalls.

    ``assume_on_leave`` adds members as if their leave were approved, to preview its effect.
    """
    pattern = RotationPattern.active_for(department)
    if pattern is None:
        return {"date": date, "platoon": None, "working": [], "on_leave": [], "traded_off": [], "shortfalls": []}

    code = pattern.platoon_code_on(date)
    assignments = {
        a.user_id: a
        for a in Assignment.objects.filter(department=department, user__is_active=True).select_related(
            "user", "platoon", "station"
        )
    }
    scheduled = {uid for uid, a in assignments.items() if a.platoon.code == code}

    on_leave = set(
        LeaveRequest.objects.filter(
            department=department,
            status=LeaveRequest.Status.APPROVED,
            start_date__lte=date,
            end_date__gte=date,
        ).values_list("user_id", flat=True)
    ) | set(assume_on_leave)
    trades = list(
        ShiftTrade.objects.filter(
            department=department, status=ShiftTrade.Status.APPROVED, shift_date=date
        ).select_related("requester", "covering_member")
    )

    working = []
    traded_off = []
    for uid in sorted(scheduled, key=lambda u: (assignments[u].station.number if assignments[u].station else "", u)):
        if uid in on_leave:
            continue
        trade = next((t for t in trades if t.requester_id == uid), None)
        a = assignments[uid]
        if trade:
            traded_off.append(_person(a.user, a))
            # The covering member rides the requester's seat.
            working.append({**_person(trade.covering_member, a), "covering_for": a.user_id})
        else:
            working.append(_person(a.user, a))

    return {
        "date": date,
        "platoon": code,
        "shift_start": pattern.shift_start,
        "shift_hours": pattern.shift_hours,
        "working": working,
        "on_leave": [_person(assignments[uid].user, assignments[uid]) for uid in sorted(scheduled & on_leave)],
        "traded_off": traded_off,
        "shortfalls": shortfalls(department, date, working),
    }


def shortfalls(department, date, working):
    """Staffing rules the working crew doesn't meet."""
    rules = list(StaffingRule.objects.filter(department=department).select_related("station", "certification_type"))
    if not rules:
        return []
    certified = {}
    if any(r.certification_type_id for r in rules):
        for cert in Certification.objects.filter(department=department, user_id__in=[p["user"] for p in working]):
            if cert.is_valid_on(date):
                certified.setdefault(cert.user_id, set()).add(cert.certification_type_id)
    result = []
    for rule in rules:
        count = sum(
            1
            for p in working
            if (rule.station_id is None or p["station"] == rule.station_id)
            and (not rule.position or p["position"] == rule.position)
            and (rule.certification_type_id is None or rule.certification_type_id in certified.get(p["user"], ()))
        )
        if count < rule.minimum:
            result.append(
                {
                    "rule": rule.id,
                    "description": str(rule),
                    "station": rule.station_id,
                    "required": rule.minimum,
                    "scheduled": count,
                }
            )
    return result


def leave_impact(leave):
    """Shortfalls that approving ``leave`` would cause or worsen, by day the member is scheduled."""
    department = leave.department
    assignment = Assignment.objects.filter(user=leave.user).select_related("platoon").first()
    pattern = RotationPattern.active_for(department)
    if assignment is None or pattern is None:
        return []
    days = []
    day = leave.start_date
    while day <= leave.end_date:
        if pattern.platoon_code_on(day) == assignment.platoon.code:
            before = {s["rule"]: s for s in build_roster(department, day)["shortfalls"]}
            after = build_roster(department, day, assume_on_leave={leave.user_id})["shortfalls"]
            caused = [s for s in after if s["rule"] not in before or s["scheduled"] < before[s["rule"]]["scheduled"]]
            if caused:
                days.append({"date": day, "shortfalls": caused})
        day += datetime.timedelta(days=1)
    return days


def _person(user, assignment):
    return {
        "user": user.id,
        "name": str(user),
        "station": assignment.station_id,
        "station_number": assignment.station.number if assignment.station else None,
        "position": assignment.position,
    }


def member_shifts(user, start, end):
    """The days ``user`` actually works between start and end: their platoon's days, minus approved leave
    and shifts traded away, plus shifts they cover for someone else. Returns [(date, note)]."""
    pattern = RotationPattern.active_for(user.department)
    if pattern is None:
        return []
    assignment = Assignment.objects.filter(user=user).select_related("platoon").first()
    leave = list(
        LeaveRequest.objects.filter(
            user=user, status=LeaveRequest.Status.APPROVED, start_date__lte=end, end_date__gte=start
        )
    )
    trades = list(
        ShiftTrade.objects.filter(status=ShiftTrade.Status.APPROVED, shift_date__range=(start, end))
        .filter(models.Q(requester=user) | models.Q(covering_member=user))
        .select_related("requester")
    )
    traded_away = {t.shift_date for t in trades if t.requester_id == user.id}
    covering = {t.shift_date: t for t in trades if t.covering_member_id == user.id}
    shifts = []
    day = start
    while day <= end:
        if day in covering:
            shifts.append((day, f"Covering for {covering[day].requester}"))
        elif (
            assignment
            and pattern.platoon_code_on(day) == assignment.platoon.code
            and day not in traded_away
            and not any(lv.start_date <= day <= lv.end_date for lv in leave)
        ):
            shifts.append((day, ""))
        day += datetime.timedelta(days=1)
    return shifts
