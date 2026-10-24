import datetime
from zoneinfo import ZoneInfo

import pytest

from apps.apparatus.models import Apparatus
from apps.reports.models import ReportSchedule
from apps.reports.scheduled import morning_briefing, send_due, weekly_overtime
from apps.scheduling.models import Assignment, OvertimeShift, Platoon, RotationPattern, StaffingRule

DAY = datetime.date(2030, 3, 4)  # a Monday; A shift works it


@pytest.fixture
def crew(department, station, make_user):
    platoons = {c: Platoon.objects.create(department=department, code=c) for c in "ABC"}
    RotationPattern.objects.create(department=department, name="24/48", anchor_date=DAY, sequence=["A", "B", "C"])
    people = {}
    for name, platoon, position in (("cap", "A", "captain"), ("ff", "A", "firefighter"), ("eng", "B", "engineer")):
        people[name] = make_user(name, last_name=name.title())
        Assignment.objects.create(
            department=department, user=people[name], platoon=platoons[platoon], station=station, position=position
        )
    return people


def test_morning_briefing_covers_the_day(department, station, crew):
    StaffingRule.objects.create(department=department, station=station, minimum=4)
    Apparatus.objects.create(
        department=department, unit_number="E1", apparatus_type="engine", station=station, status="out_of_service"
    )
    OvertimeShift.objects.create(department=department, user=crew["eng"], date=DAY, filling_for=crew["cap"])
    subject, body = morning_briefing(department, DAY)
    assert subject == "Morning briefing: Mon Mar 4 · A Shift on duty"
    # The captain and firefighter, plus the engineer hired on overtime.
    assert f"Station {station.number}: 3 on duty (1 on overtime)" in body
    assert "E1 out of service" in body
    assert "(mandatory) for Cap" in body
    assert "SHORT:" in body  # 3 working against a minimum of 4


def test_weekly_overtime_summary(department, crew):
    OvertimeShift.objects.create(department=department, user=crew["eng"], date=DAY - datetime.timedelta(days=2))
    OvertimeShift.objects.create(
        department=department, user=crew["ff"], date=DAY - datetime.timedelta(days=3), hours=12, mandatory=False
    )
    subject, body = weekly_overtime(department, DAY)
    assert subject == "Weekly overtime summary: week ending Sun Mar 3"
    assert "2 shifts, 36 hours (1 mandatory, 1 volunteered)" in body
    assert body.index("Eng: 24 hours") < body.index("Ff: 12 hours")


def test_reports_go_out_once_at_their_time(department, crew, admin_user, officer, member, mailoutbox):
    for user, address in ((admin_user, "chief@example.com"), (officer, "cpt@example.com"), (member, "ff@x.com")):
        user.email = address
        user.save()
    department.timezone = "America/Chicago"
    department.save()
    ReportSchedule.objects.create(
        department=department,
        report="morning_briefing",
        enabled=True,
        send_at=datetime.time(6, 30),
        extra_emails="mayor@example.com",
    )
    ReportSchedule.objects.create(department=department, report="weekly_overtime", enabled=True, weekday=1)
    chicago = ZoneInfo("America/Chicago")

    send_due(datetime.datetime(2030, 3, 4, 6, 0, tzinfo=chicago))  # too early
    assert mailoutbox == []
    send_due(datetime.datetime(2030, 3, 4, 6, 45, tzinfo=chicago))
    send_due(datetime.datetime(2030, 3, 4, 9, 0, tzinfo=chicago))  # already sent today
    assert len(mailoutbox) == 1  # the weekly one waits for Tuesday
    assert mailoutbox[0].subject.startswith(f"{department.name}: Morning briefing: Mon Mar 4")
    assert sorted(mailoutbox[0].to) == ["chief@example.com", "cpt@example.com", "mayor@example.com"]
    send_due(datetime.datetime(2030, 3, 5, 7, 0, tzinfo=chicago))
    assert sorted(m.subject.split(": ", 1)[1].split(":")[0] for m in mailoutbox[1:]) == [
        "Morning briefing",
        "Weekly overtime summary",
    ]


def test_report_settings_preview_and_test_send(client_for, admin_user, officer, crew, mailoutbox):
    url = "/api/v1/report-schedules/"
    assert client_for(officer).get(url).status_code == 403
    rows = client_for(admin_user).get(url).json()
    assert [(r["report"], r["enabled"]) for r in rows] == [("morning_briefing", False), ("weekly_overtime", False)]

    change = {**rows[0], "enabled": True, "send_at": "07:15", "extra_emails": "mayor@example.com\n"}
    saved = client_for(admin_user).patch(url, [change], format="json").json()[0]
    assert (saved["enabled"], saved["send_at"], saved["extra_emails"]) == (True, "07:15:00", "mayor@example.com")
    bad = {**rows[0], "extra_emails": "not an email"}
    assert client_for(admin_user).patch(url, [bad], format="json").status_code == 400

    preview = client_for(officer).get(f"{url}morning_briefing/preview/").json()
    assert preview["subject"].startswith("Morning briefing")
    assert client_for(officer).get(f"{url}nope/preview/").status_code == 404

    assert client_for(admin_user).post(f"{url}weekly_overtime/send-test/").status_code == 400  # no email yet
    admin_user.email = "chief@example.com"
    admin_user.save()
    assert client_for(admin_user).post(f"{url}weekly_overtime/send-test/").status_code == 204
    assert mailoutbox[-1].to == ["chief@example.com"]
