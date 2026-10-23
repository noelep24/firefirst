import datetime

import pytest

from apps.scheduling.models import Assignment, LeaveRequest, Platoon, RotationPattern, ShiftTrade

ANCHOR = datetime.date(2026, 1, 1)  # A shift works this day
A_DAY = ANCHOR + datetime.timedelta(days=30)  # 30 % 3 == 0 -> A
B_DAY = A_DAY + datetime.timedelta(days=1)


@pytest.fixture
def platoons(department):
    return {c: Platoon.objects.create(department=department, code=c) for c in "ABC"}


@pytest.fixture
def pattern(department, platoons):
    return RotationPattern.objects.create(
        department=department, name="24/48", anchor_date=ANCHOR, sequence=["A", "B", "C"]
    )


@pytest.fixture
def crew(department, station, platoons, pattern, make_user):
    """Two A-shift members and one B-shift member at Station 1."""
    people = {
        "a1": make_user("a1", last_name="Adams"),
        "a2": make_user("a2", last_name="Baker"),
        "b1": make_user("b1", last_name="Cole"),
    }
    for name, user in people.items():
        Assignment.objects.create(department=department, user=user, platoon=platoons[name[0].upper()], station=station)
    return people


def test_rotation(pattern):
    assert [pattern.platoon_code_on(ANCHOR + datetime.timedelta(days=d)) for d in range(-1, 5)] == list("CABCAB")


def test_pattern_rejects_unknown_codes(client_for, officer, platoons):
    response = client_for(officer).post(
        "/api/v1/rotation-patterns/",
        {"name": "Bad", "anchor_date": "2026-01-01", "sequence": ["A", "D"]},
        format="json",
    )
    assert response.status_code == 400


def test_activating_pattern_deactivates_others(client_for, officer, pattern):
    client_for(officer).post(
        "/api/v1/rotation-patterns/",
        {"name": "48/96", "anchor_date": "2026-01-01", "sequence": ["A", "A", "B", "B", "C", "C"]},
        format="json",
    )
    pattern.refresh_from_db()
    assert not pattern.is_active


def test_shift_calendar(client_for, member, pattern):
    days = client_for(member).get("/api/v1/shift-calendar/?start=2026-01-01&end=2026-01-04").json()
    assert [d["platoon"] for d in days] == list("ABCA")


def test_roster_with_leave_and_trade(client_for, officer, department, crew):
    a1, a2, b1 = crew["a1"], crew["a2"], crew["b1"]
    LeaveRequest.objects.create(
        department=department, user=a1, leave_type="vacation", start_date=A_DAY, end_date=A_DAY, status="approved"
    )
    ShiftTrade.objects.create(
        department=department, requester=a2, covering_member=b1, shift_date=A_DAY, status="approved"
    )

    roster = client_for(officer).get(f"/api/v1/roster/?date={A_DAY}").json()
    assert roster["platoon"] == "A"
    assert [p["user"] for p in roster["on_leave"]] == [a1.id]
    assert [p["user"] for p in roster["traded_off"]] == [a2.id]
    assert roster["working"] == [
        {
            "user": b1.id,
            "name": str(b1),
            "station": a2.assignment.station_id,
            "station_number": "1",
            "position": "firefighter",
            "covering_for": a2.id,
        }
    ]


def test_pending_leave_does_not_affect_roster(client_for, member, department, crew):
    LeaveRequest.objects.create(
        department=department, user=crew["a1"], leave_type="sick", start_date=A_DAY, end_date=A_DAY
    )
    roster = client_for(member).get(f"/api/v1/roster/?date={A_DAY}").json()
    assert {p["user"] for p in roster["working"]} == {crew["a1"].id, crew["a2"].id}


def test_leave_request_flow(client_for, member, officer):
    created = client_for(member).post(
        "/api/v1/leave-requests/", {"leave_type": "vacation", "start_date": "2026-11-01", "end_date": "2026-11-03"}
    )
    assert created.status_code == 201
    leave_id = created.json()["id"]
    assert created.json()["user"] == member.id
    assert client_for(member).post(f"/api/v1/leave-requests/{leave_id}/approve/").status_code == 403

    approved = client_for(officer).post(f"/api/v1/leave-requests/{leave_id}/approve/", {"note": "Enjoy"})
    assert approved.json()["status"] == "approved"
    assert client_for(officer).post(f"/api/v1/leave-requests/{leave_id}/deny/").status_code == 400


def test_leave_end_before_start(client_for, member):
    response = client_for(member).post(
        "/api/v1/leave-requests/", {"leave_type": "vacation", "start_date": "2026-11-03", "end_date": "2026-11-01"}
    )
    assert response.status_code == 400


def test_members_only_see_their_own_leave(client_for, member, officer, department, make_user):
    other = make_user("ff2")
    LeaveRequest.objects.create(department=department, user=other, leave_type="sick", start_date=A_DAY, end_date=A_DAY)
    assert client_for(member).get("/api/v1/leave-requests/").json()["results"] == []
    assert len(client_for(officer).get("/api/v1/leave-requests/").json()["results"]) == 1


def test_member_cannot_file_leave_for_someone_else(client_for, member, make_user):
    other = make_user("ff2")
    response = client_for(member).post(
        "/api/v1/leave-requests/",
        {"user": other.id, "leave_type": "vacation", "start_date": "2026-11-01", "end_date": "2026-11-01"},
    )
    assert response.status_code == 400


def test_shift_trade_flow(client_for, officer, crew):
    a1, b1 = crew["a1"], crew["b1"]
    created = client_for(a1).post("/api/v1/shift-trades/", {"covering_member": b1.id, "shift_date": str(A_DAY)})
    assert created.status_code == 201, created.json()
    trade_id = created.json()["id"]

    # Requester can't accept on the partner's behalf, and officers can't approve before the partner accepts.
    assert client_for(a1).post(f"/api/v1/shift-trades/{trade_id}/accept/").status_code == 403
    assert client_for(officer).post(f"/api/v1/shift-trades/{trade_id}/approve/").status_code == 400

    assert client_for(b1).post(f"/api/v1/shift-trades/{trade_id}/accept/").json()["status"] == "pending_approval"
    assert client_for(b1).post(f"/api/v1/shift-trades/{trade_id}/approve/").status_code == 403
    approved = client_for(officer).post(f"/api/v1/shift-trades/{trade_id}/approve/").json()
    assert approved["status"] == "approved"
    assert approved["reviewed_by"] == officer.id


def test_trade_must_be_on_requesters_shift(client_for, crew):
    response = client_for(crew["a1"]).post(
        "/api/v1/shift-trades/", {"covering_member": crew["b1"].id, "shift_date": str(B_DAY)}
    )
    assert response.status_code == 400


def test_trade_partner_cannot_already_be_working(client_for, crew):
    response = client_for(crew["a1"]).post(
        "/api/v1/shift-trades/", {"covering_member": crew["a2"].id, "shift_date": str(A_DAY)}
    )
    assert response.status_code == 400


def test_uninvolved_members_cannot_see_trades(client_for, department, crew, make_user):
    ShiftTrade.objects.create(department=department, requester=crew["a1"], covering_member=crew["b1"], shift_date=A_DAY)
    assert client_for(make_user("bystander")).get("/api/v1/shift-trades/").json()["results"] == []


def test_officers_cannot_review_their_own_leave(client_for, officer):
    created = client_for(officer).post(
        "/api/v1/leave-requests/", {"leave_type": "vacation", "start_date": "2026-11-01", "end_date": "2026-11-01"}
    )
    leave_id = created.json()["id"]
    assert client_for(officer).post(f"/api/v1/leave-requests/{leave_id}/approve/").status_code == 403
    assert LeaveRequest.objects.get(id=leave_id).status == "pending"


def test_officers_cannot_review_trades_they_are_part_of(client_for, department, crew, make_user, platoons, station):
    captain = make_user("cap-b", "officer")
    Assignment.objects.create(department=department, user=captain, platoon=platoons["B"], station=station)
    trade = ShiftTrade.objects.create(
        department=department,
        requester=crew["a1"],
        covering_member=captain,
        shift_date=A_DAY,
        status="pending_approval",
    )
    assert client_for(captain).post(f"/api/v1/shift-trades/{trade.id}/approve/").status_code == 403
    assert client_for(captain).post(f"/api/v1/shift-trades/{trade.id}/deny/").status_code == 403


# ---------------------------------------------------------------- Staffing


@pytest.fixture
def medic_cert(department):
    from apps.certifications.models import CertificationType

    return CertificationType.objects.create(department=department, name="Paramedic")


def test_roster_reports_shortfalls(client_for, officer, department, station, crew, medic_cert):
    from apps.certifications.models import Certification
    from apps.scheduling.models import StaffingRule

    StaffingRule.objects.create(department=department, station=station, minimum=2)
    StaffingRule.objects.create(department=department, station=station, certification_type=medic_cert, minimum=1)
    roster = client_for(officer).get(f"/api/v1/roster/?date={A_DAY}").json()
    assert [(s["required"], s["scheduled"]) for s in roster["shortfalls"]] == [(1, 0)]  # 2 on duty, no medic

    Certification.objects.create(department=department, user=crew["a2"], certification_type=medic_cert)
    assert client_for(officer).get(f"/api/v1/roster/?date={A_DAY}").json()["shortfalls"] == []


def test_expired_certification_does_not_count(client_for, officer, department, station, crew, medic_cert):
    from apps.certifications.models import Certification
    from apps.scheduling.models import StaffingRule

    StaffingRule.objects.create(department=department, certification_type=medic_cert, minimum=1)
    Certification.objects.create(
        department=department,
        user=crew["a1"],
        certification_type=medic_cert,
        expires_on=A_DAY - datetime.timedelta(days=1),
    )
    assert len(client_for(officer).get(f"/api/v1/roster/?date={A_DAY}").json()["shortfalls"]) == 1


def test_covering_member_counts_with_their_own_certs(client_for, officer, department, station, crew, medic_cert):
    from apps.certifications.models import Certification
    from apps.scheduling.models import StaffingRule

    StaffingRule.objects.create(department=department, station=station, certification_type=medic_cert, minimum=1)
    Certification.objects.create(department=department, user=crew["b1"], certification_type=medic_cert)
    ShiftTrade.objects.create(
        department=department, requester=crew["a1"], covering_member=crew["b1"], shift_date=A_DAY, status="approved"
    )
    assert client_for(officer).get(f"/api/v1/roster/?date={A_DAY}").json()["shortfalls"] == []


def test_leave_impact_and_outlook(client_for, officer, department, station, crew):
    from apps.scheduling.models import StaffingRule

    StaffingRule.objects.create(department=department, station=station, minimum=2)
    leave = LeaveRequest.objects.create(
        department=department, user=crew["a1"], leave_type="vacation", start_date=A_DAY, end_date=B_DAY
    )
    impact = client_for(officer).get(f"/api/v1/leave-requests/{leave.id}/impact/").json()
    # Only the A-shift day matters; B_DAY isn't one of their shifts.
    assert [d["date"] for d in impact] == [str(A_DAY)]
    assert impact[0]["shortfalls"][0]["scheduled"] == 1

    # B shift only has one member at Station 1, so that day is already short; look at the A day alone.
    assert client_for(officer).get(f"/api/v1/staffing/?start={A_DAY}&end={A_DAY}").json() == []
    leave.status = "approved"
    leave.save()
    outlook = client_for(officer).get(f"/api/v1/staffing/?start={A_DAY}&end={A_DAY}").json()
    assert [d["date"] for d in outlook] == [str(A_DAY)]


def test_members_cannot_see_leave_impact(client_for, member, department, crew):
    leave = LeaveRequest.objects.create(
        department=department, user=member, leave_type="vacation", start_date=A_DAY, end_date=A_DAY
    )
    assert client_for(member).get(f"/api/v1/leave-requests/{leave.id}/impact/").status_code == 403


def test_staffing_rule_validation_and_description(client_for, officer, station, medic_cert):
    client = client_for(officer)
    assert client.post("/api/v1/staffing-rules/", {"station": station.id, "minimum": 0}).status_code == 400
    created = client.post(
        "/api/v1/staffing-rules/", {"station": station.id, "certification_type": medic_cert.id, "minimum": 1}
    ).json()
    assert created["description"] == "Station 1 – Headquarters: at least 1 Paramedic"
