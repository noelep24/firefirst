"""Who is working on a given day."""

import datetime

from django.db import models

from apps.apparatus.models import Apparatus, ApparatusMove
from apps.certifications.models import Certification
from apps.core.models import Station

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
            "user", "platoon", "station", "apparatus"
        )
    }
    scheduled = {uid for uid, a in assignments.items() if a.platoon.code == code}
    seats = Seats(department, date)

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
            traded_off.append(_person(a.user, a, seats))
            # The covering member rides the requester's seat.
            working.append({**_person(trade.covering_member, a, seats), "covering_for": a.user_id})
        else:
            working.append(_person(a.user, a, seats))

    return {
        "date": date,
        "platoon": code,
        "shift_start": pattern.shift_start,
        "shift_hours": pattern.shift_hours,
        "working": working,
        "on_leave": [_person(assignments[uid].user, assignments[uid], seats) for uid in sorted(scheduled & on_leave)],
        "traded_off": traded_off,
        "shortfalls": shortfalls(department, date, working),
    }


def station_board(user, date, station=None):
    """The Today screen for ``user``: their own assignment for the day, plus the crew and rigs at
    ``station`` (default: where they work today, else their assigned or home station)."""
    department = user.department
    roster = build_roster(department, date)
    assignment = Assignment.objects.filter(user=user).select_related("platoon", "station", "apparatus").first()
    working = next((p for p in roster["working"] if p["user"] == user.id), None)
    stations = list(Station.objects.filter(department=department))

    if station is None:
        preferred = (working and working["station"]) or (assignment and assignment.station_id) or user.home_station_id
        station = next((s for s in stations if s.id == preferred), stations[0] if stations else None)

    here = station.id if station else None
    moves = ApparatusMove.active_on(department, date)
    fleet = list(Apparatus.objects.filter(department=department).select_related("station"))
    # Rigs here today: based here and not away, or visiting on a temporary move.
    rigs = [r for r in fleet if here and (moves[r.id].station_id if r.id in moves else r.station_id) == here]
    away = [r for r in fleet if r.station_id == here and r.id in moves and moves[r.id].station_id != here]
    rig_ids = {rig.id for rig in rigs}

    return {
        "date": date,
        "platoon": roster["platoon"],
        "me": _board_member(user, assignment, working, roster, Seats(department, date, moves)),
        "stations": [_board_station(s) for s in stations],
        "station": _board_station(station) if station else None,
        "apparatus": [
            {
                "id": rig.id,
                "unit_number": rig.unit_number,
                "apparatus_type": rig.apparatus_type,
                "status": rig.status,
                "crew": [p for p in roster["working"] if p["apparatus"] == rig.id],
                "visiting": _visit(moves[rig.id]) if rig.id in moves else None,
            }
            for rig in rigs
        ],
        "away": [
            {
                "id": rig.id,
                "unit_number": rig.unit_number,
                "station_number": moves[rig.id].station.number,
                "until": moves[rig.id].ends_on,
            }
            for rig in away
        ],
        "unassigned": [p for p in roster["working"] if p["station"] == here and p["apparatus"] not in rig_ids],
        "on_leave": [p for p in roster["on_leave"] if p["station"] == here],
        "traded_off": [p for p in roster["traded_off"] if p["station"] == here],
        "shortfalls": [s for s in roster["shortfalls"] if s["station"] == here],
    }


def _visit(move):
    home = move.apparatus.station
    return {
        "home_station_number": home.number if home else None,
        "until": move.ends_on,
        "covering_for_unit": move.covering_for.unit_number if move.covering_for else None,
        "reason": move.reason,
    }


def _board_station(station):
    return {"id": station.id, "number": station.number, "name": station.name}


def _board_member(user, assignment, working, roster, seats):
    # Covering a trade puts the member in the requester's seat for the day.
    seat = working or (_person(user, assignment, seats) if assignment else None)
    if working and working.get("covering_for"):
        status = "covering"
        covered = Assignment.objects.select_related("user").get(user_id=working["covering_for"]).user
        note = f"Covering for {covered}"
    elif working:
        status, note = "on_duty", ""
    elif any(p["user"] == user.id for p in roster["on_leave"]):
        status, note = "on_leave", ""
    elif any(p["user"] == user.id for p in roster["traded_off"]):
        status, note = "traded_off", ""
    else:
        status, note = "off_duty", ""
    station = None
    if seat and seat["station"]:
        station = _board_station(Station.objects.get(pk=seat["station"]))
    return {
        "name": str(user),
        "rank": user.rank,
        "platoon": assignment.platoon.code if assignment else None,
        "station": station,
        "position": seat["position"] if seat else None,
        "apparatus": seat["apparatus"] if seat else None,
        "apparatus_unit": seat["apparatus_unit"] if seat else None,
        "on_duty": working is not None,
        "status": status,
        "note": note,
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


class Seats:
    """Where an assignment actually rides on a date, after rig moves.

    A rig covering for another (a reserve engine while the frontline one is in the shop) carries the
    covered rig's crew, at the covering rig's station. A rig on a temporary move takes its crew along
    if the move says so; otherwise they stay at their station without a rig.
    """

    def __init__(self, department, date, moves=None):
        self.moves = ApparatusMove.active_on(department, date) if moves is None else moves
        self.covering = {m.covering_for_id: m for m in self.moves.values() if m.covering_for_id}

    def of(self, assignment):
        station, rig = assignment.station, assignment.apparatus
        if rig is not None and rig.id in self.covering:
            move = self.covering[rig.id]
            station, rig = move.station, move.apparatus
        elif rig is not None and rig.id in self.moves:
            move = self.moves[rig.id]
            if move.crew_moves:
                station = move.station
            else:
                rig = None
        return station, rig


def _person(user, assignment, seats=None):
    station, rig = seats.of(assignment) if seats else (assignment.station, assignment.apparatus)
    return {
        "user": user.id,
        "name": str(user),
        "station": station.id if station else None,
        "station_number": station.number if station else None,
        "position": assignment.position,
        "rank": user.rank,
        "apparatus": rig.id if rig else None,
        "apparatus_unit": rig.unit_number if rig else None,
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
