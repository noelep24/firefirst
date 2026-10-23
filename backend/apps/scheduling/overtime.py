"""The rolling mandatory overtime list.

Members are split into two lists by riding position: officers and engineers can fill each other's seats,
and firefighters and medics can fill each other's. Whoever worked overtime longest ago (or never) is at
the top; working an overtime shift sends them to the bottom (and, where the department says so, so does
turning one down).
"""

from django.db.models import Max

from .models import Assignment, LeaveRequest, OvertimeOffer, OvertimeSettings, OvertimeShift
from .roster import build_roster

P = Assignment.Position
LISTS = [
    ("officers", "Captains & engineers", {P.CAPTAIN, P.LIEUTENANT, P.ENGINEER}),
    ("firefighters", "Firefighters & medics", {P.FIREFIGHTER, P.PARAMEDIC, P.EMT}),
]


def list_for(position):
    """Which overtime list a riding position belongs to (None for shift chiefs)."""
    return next((key for key, _label, positions in LISTS if position in positions), None)


def overtime_list(department, date):
    """Both lists in order as of ``date``, with whether each member can be hired that day."""
    roster = build_roster(department, date)
    working = {p["user"]: p for p in roster["working"]}
    on_leave = set(
        LeaveRequest.objects.filter(
            department=department, status=LeaveRequest.Status.APPROVED, start_date__lte=date, end_date__gte=date
        ).values_list("user_id", flat=True)
    )
    # The order comes from overtime worked before the day being filled.
    last = dict(
        OvertimeShift.objects.filter(department=department, date__lt=date)
        .values("user")
        .annotate(last=Max("date"))
        .values_list("user", "last")
    )
    if OvertimeSettings.for_department(department).refusal_moves_to_bottom:
        # Turning down an offer counts like working it.
        refused = (
            OvertimeOffer.objects.filter(
                department=department,
                status__in=[OvertimeOffer.Status.DECLINED, OvertimeOffer.Status.EXPIRED],
                vacancy__date__lt=date,
            )
            .values("user")
            .annotate(last=Max("vacancy__date"))
            .values_list("user", "last")
        )
        for user, day in refused:
            last[user] = max(last.get(user, day), day)
    hired_today = set(OvertimeShift.objects.filter(department=department, date=date).values_list("user_id", flat=True))
    assignments = Assignment.objects.filter(department=department, user__is_active=True).select_related(
        "user", "station", "platoon"
    )

    def status(user_id):
        if user_id in hired_today:
            return "overtime"
        if user_id in on_leave:
            return "on_leave"
        if user_id in working:
            return "on_duty"
        return "available"

    lists = []
    for key, label, positions in LISTS:
        members = [a for a in assignments if a.position in positions]
        # Never worked overtime first, then oldest overtime first; ties go alphabetically.
        members.sort(key=lambda a: (last.get(a.user_id) is not None, last.get(a.user_id) or date, a.user.last_name))
        rows = [
            {
                "user": a.user_id,
                "name": str(a.user),
                "rank": a.user.rank,
                "position": a.position,
                "platoon": a.platoon.code,
                "station_number": a.station.number if a.station else None,
                "last_overtime": last.get(a.user_id),
                "status": status(a.user_id),
            }
            for a in members
        ]
        next_up = next((r["user"] for r in rows if r["status"] == "available"), None)
        lists.append({"key": key, "label": label, "members": rows, "next_up": next_up})
    return {"date": date, "platoon": roster["platoon"], "lists": lists}
