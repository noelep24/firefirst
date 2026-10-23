"""Who is working on a given day."""

from .models import Assignment, LeaveRequest, RotationPattern, ShiftTrade


def platoon_on(department, date):
    pattern = RotationPattern.active_for(department)
    return pattern.platoon_code_on(date) if pattern else None


def build_roster(department, date):
    """Return the on-duty platoon plus who is working, off on leave, and covering trades."""
    pattern = RotationPattern.active_for(department)
    if pattern is None:
        return {"date": date, "platoon": None, "working": [], "on_leave": [], "traded_off": []}

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
    )
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
    }


def _person(user, assignment):
    return {
        "user": user.id,
        "name": str(user),
        "station": assignment.station_id,
        "station_number": assignment.station.number if assignment.station else None,
        "position": assignment.position,
    }
