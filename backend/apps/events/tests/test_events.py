import datetime

import pytest
from django.utils import timezone

from apps.events.models import Attendance, Event


@pytest.fixture
def drill(department, officer):
    start = timezone.now() + datetime.timedelta(days=2)
    return Event.objects.create(
        department=department,
        title="Ladder drill",
        category="training",
        created_by=officer,
        starts_at=start,
        ends_at=start + datetime.timedelta(hours=3),
        training_hours=3,
    )


def test_mandatory_event_invites_everyone(client_for, officer, member, make_user, other_department):
    make_user("outsider", dept=other_department)
    response = client_for(officer).post(
        "/api/v1/events/",
        {
            "title": "Quarterly meeting",
            "category": "meeting",
            "is_mandatory": True,
            "starts_at": "2026-11-05T18:00:00Z",
            "ends_at": "2026-11-05T20:00:00Z",
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    invited = {a["user"] for a in response.json()["attendance"]}
    assert invited == {officer.id, member.id}


def test_event_end_before_start(client_for, officer):
    response = client_for(officer).post(
        "/api/v1/events/",
        {"title": "x", "starts_at": "2026-11-05T18:00:00Z", "ends_at": "2026-11-05T17:00:00Z"},
        format="json",
    )
    assert response.status_code == 400


def test_members_cannot_create_events(client_for, member):
    response = client_for(member).post(
        "/api/v1/events/", {"title": "x", "starts_at": "2026-11-05T18:00:00Z", "ends_at": "2026-11-05T19:00:00Z"}
    )
    assert response.status_code == 403


def test_rsvp(client_for, member, drill):
    response = client_for(member).post(f"/api/v1/events/{drill.id}/rsvp/", {"status": "going"})
    assert response.json()["my_status"] == "going"


def test_date_range_filter(client_for, member, drill):
    client = client_for(member)
    day = drill.starts_at.date()
    assert len(client.get(f"/api/v1/events/?start={day}&end={day}").json()["results"]) == 1
    later = day + datetime.timedelta(days=5)
    assert client.get(f"/api/v1/events/?start={later}").json()["results"] == []


def test_attendance_and_training_hours(client_for, officer, member, make_user, drill):
    no_show = make_user("ff2")
    response = client_for(officer).post(
        f"/api/v1/events/{drill.id}/attendance/", {"attended": [member.id], "absent": [no_show.id]}, format="json"
    )
    assert response.status_code == 200
    assert Attendance.objects.get(user=no_show).status == "absent"

    hours = client_for(officer).get("/api/v1/events/training-hours/").json()
    assert [(r["user"], float(r["hours"])) for r in hours] == [(member.id, 3.0)]
    # Members only see their own totals.
    assert client_for(no_show).get("/api/v1/events/training-hours/").json() == []


def test_cannot_mark_attendance_for_other_departments(client_for, officer, make_user, other_department, drill):
    outsider = make_user("outsider", dept=other_department)
    response = client_for(officer).post(
        f"/api/v1/events/{drill.id}/attendance/", {"attended": [outsider.id]}, format="json"
    )
    assert response.status_code == 400


def test_members_cannot_mark_attendance(client_for, member, drill):
    response = client_for(member).post(
        f"/api/v1/events/{drill.id}/attendance/", {"attended": [member.id]}, format="json"
    )
    assert response.status_code == 403
