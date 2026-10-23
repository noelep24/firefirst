import datetime
from zoneinfo import ZoneInfo

import pytest

from apps.core.models import Station
from apps.events.ical import _fold
from apps.events.models import Event
from apps.events.recurrence import occurrence_dates, occurrence_starts
from apps.scheduling.models import Assignment, LeaveRequest, Platoon, RotationPattern, ShiftTrade

CHICAGO = ZoneInfo("America/Chicago")


def d(s):
    return datetime.date.fromisoformat(s)


# ---------------------------------------------------------------- Recurrence


def test_weekly_every_other_week():
    assert occurrence_dates(d("2026-11-03"), "weekly", interval=2, count=3) == [
        d("2026-11-03"),
        d("2026-11-17"),
        d("2026-12-01"),
    ]


def test_monthly_date_clamps_short_months():
    assert occurrence_dates(d("2026-01-31"), "monthly_date", until=d("2026-04-30")) == [
        d("2026-01-31"),
        d("2026-02-28"),
        d("2026-03-31"),
        d("2026-04-30"),
    ]


def test_monthly_weekday_second_tuesday():
    # 2026-11-10 is the 2nd Tuesday of November.
    assert occurrence_dates(d("2026-11-10"), "monthly_weekday", count=3) == [
        d("2026-11-10"),
        d("2026-12-08"),
        d("2027-01-12"),
    ]


def test_monthly_weekday_last_friday():
    # 2026-10-30 is the 5th (last) Friday; months with four Fridays use the last one.
    assert occurrence_dates(d("2026-10-30"), "monthly_weekday", count=3) == [
        d("2026-10-30"),
        d("2026-11-27"),
        d("2026-12-25"),
    ]


def test_needs_an_end_and_is_capped():
    with pytest.raises(ValueError):
        occurrence_dates(d("2026-01-01"), "weekly")
    assert len(occurrence_dates(d("2026-01-01"), "weekly", until=d("2040-01-01"))) == 104


def test_wall_clock_time_survives_daylight_saving():
    first = datetime.datetime(2026, 10, 27, 19, 0, tzinfo=CHICAGO)  # CDT
    starts = occurrence_starts(first, "America/Chicago", "weekly", count=2)
    assert [s.astimezone(CHICAGO).hour for s in starts] == [19, 19]  # second one is after DST ends (CST)


def test_create_repeating_event(client_for, officer, member, department):
    department.timezone = "America/Chicago"
    department.save()
    response = client_for(officer).post(
        "/api/v1/events/",
        {
            "title": "Business meeting",
            "category": "meeting",
            "starts_at": "2026-11-10T19:00:00-06:00",
            "ends_at": "2026-11-10T21:00:00-06:00",
            "repeat": "monthly_weekday",
            "repeat_count": 3,
            "invitees": [member.id],
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    events = list(Event.objects.order_by("starts_at"))
    assert [e.starts_at.astimezone(CHICAGO).date() for e in events] == [
        d("2026-11-10"),
        d("2026-12-08"),
        d("2027-01-12"),
    ]
    assert len({e.series for e in events}) == 1 and events[0].series is not None
    assert all(e.attendance.filter(user=member).exists() for e in events)
    assert all(e.ends_at - e.starts_at == datetime.timedelta(hours=2) for e in events)


def test_repeat_validation(client_for, officer):
    base = {"title": "x", "starts_at": "2026-11-10T19:00:00Z", "ends_at": "2026-11-10T20:00:00Z", "repeat": "weekly"}
    client = client_for(officer)
    assert "repeat_until" in client.post("/api/v1/events/", base, format="json").json()
    early = {**base, "repeat_until": "2026-11-01"}
    assert client.post("/api/v1/events/", early, format="json").status_code == 400


def test_delete_this_and_following(client_for, officer):
    client = client_for(officer)
    client.post(
        "/api/v1/events/",
        {
            "title": "Drill",
            "starts_at": "2026-11-03T14:00:00Z",
            "ends_at": "2026-11-03T16:00:00Z",
            "repeat": "weekly",
            "repeat_count": 4,
        },
        format="json",
    )
    events = list(Event.objects.order_by("starts_at"))
    assert client.delete(f"/api/v1/events/{events[2].id}/?scope=following").status_code == 204
    assert list(Event.objects.order_by("starts_at")) == events[:2]
    client.delete(f"/api/v1/events/{events[0].id}/")
    assert list(Event.objects.all()) == [events[1]]


# ---------------------------------------------------------------- Calendar feed


@pytest.fixture
def scheduled_member(department, member):
    department.timezone = "America/Chicago"
    department.save()
    station = Station.objects.create(department=department, number="1")
    a = Platoon.objects.create(department=department, code="A")
    b = Platoon.objects.create(department=department, code="B")
    RotationPattern.objects.create(
        department=department, name="24/48", anchor_date=datetime.date.today(), sequence=["A", "B"]
    )
    Assignment.objects.create(department=department, user=member, platoon=a, station=station)
    member.home_station = station
    member.save()
    return {"member": member, "station": station, "b": b}


def feed_for(client_for, user):
    link = client_for(user).get("/api/v1/me/calendar-feed/").json()
    assert link["webcal_url"].startswith("webcal://")
    response = client_for(user).get(link["url"].split("testserver", 1)[1])
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/calendar")
    return response.content.decode(), link


def test_feed_has_shifts_minus_leave_plus_trades(client_for, department, scheduled_member, make_user):
    member = scheduled_member["member"]
    today = datetime.date.today()
    # A, B, A, B…: member works today, today+2, today+4…
    LeaveRequest.objects.create(
        department=department,
        user=member,
        leave_type="vacation",
        status="approved",
        start_date=today + datetime.timedelta(days=2),
        end_date=today + datetime.timedelta(days=2),
    )
    partner = make_user("b-shift", first_name="Bo", last_name="Bee")
    Assignment.objects.create(
        department=department, user=partner, platoon=scheduled_member["b"], station=scheduled_member["station"]
    )
    ShiftTrade.objects.create(
        department=department,
        requester=partner,
        covering_member=member,
        shift_date=today + datetime.timedelta(days=3),
        status="approved",
    )
    ics, _ = feed_for(client_for, member)
    shift_days = sorted(
        line.split("-", 2)[2].split("@")[0] for line in ics.split("\r\n") if line.startswith("UID:shift-")
    )
    assert str(today) in shift_days
    assert str(today + datetime.timedelta(days=2)) not in shift_days  # on leave
    assert str(today + datetime.timedelta(days=3)) in shift_days  # covering a B shift
    assert "SUMMARY:On duty (Covering for Bo Bee)" in ics
    assert ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n")


def test_feed_events_escaped(client_for, department, scheduled_member):
    member = scheduled_member["member"]
    start = datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=1)
    Event.objects.create(
        department=department,
        title="Hose test; pump 2, line A",
        starts_at=start,
        ends_at=start + datetime.timedelta(hours=1),
        is_mandatory=True,
    )
    ics, _ = feed_for(client_for, member)
    assert "SUMMARY:Hose test\; pump 2\\, line A (mandatory)" in ics


def test_regenerating_revokes_the_old_link(client_for, scheduled_member, client):
    member = scheduled_member["member"]
    _, link = feed_for(client_for, member)
    old_path = link["url"].split("testserver", 1)[1]
    new = client_for(member).post("/api/v1/me/calendar-feed/").json()
    assert new["url"] != link["url"]
    assert client.get(old_path).status_code == 404
    assert client.get("/calendar/.ics").status_code == 404


def test_fold_long_lines():
    line = "SUMMARY:" + "é" * 60
    folded = _fold(line)
    assert all(len(part.encode()) <= 75 for part in folded.split("\r\n"))
    assert folded.replace("\r\n ", "") == line
