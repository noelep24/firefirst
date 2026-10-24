import json

from apps.notifications.models import Notification, PushDevice
from apps.notifications.send import notify

TOKEN = "ExponentPushToken[abc123]"


def test_members_see_and_clear_their_own_notifications(client_for, member, officer):
    notify("overtime_offer", [member], "Overtime available Sat Oct 24", "Engineer seat", "/schedule")
    notify("overtime_offer", [officer], "For someone else")
    client = client_for(member)
    rows = client.get("/api/v1/notifications/").json()["results"]
    assert [(r["title"], r["read_at"]) for r in rows] == [("Overtime available Sat Oct 24", None)]
    assert client.post(f"/api/v1/notifications/{rows[0]['id']}/read/").json()["read_at"]
    notify("overtime_offer", [member], "Another")
    assert client.post("/api/v1/notifications/read-all/").status_code == 204
    assert not Notification.objects.filter(user=member, read_at=None).exists()
    assert Notification.objects.filter(user=officer, read_at=None).count() == 1


def test_phones_register_for_push_and_get_notified(client_for, member, officer, settings, monkeypatch):
    client = client_for(member)
    assert client.post("/api/v1/push-devices/", {"token": "nope"}).status_code == 400
    assert client.post("/api/v1/push-devices/", {"token": TOKEN, "platform": "ios"}).status_code == 204
    # The same phone signed in by someone else now belongs to them.
    assert client_for(officer).post("/api/v1/push-devices/", {"token": TOKEN}).status_code == 204
    assert PushDevice.objects.get(token=TOKEN).user == officer

    sent = []

    class Response:
        def close(self):
            pass

    def fake_urlopen(request, timeout):
        sent.append(json.loads(request.data))
        return Response()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    settings.PUSH_NOTIFICATIONS_ENABLED = True
    notify("vacancy_unfilled", [officer], "Vacancy still open", "No one is available", "/schedule")
    assert sent == [
        [
            {
                "to": TOKEN,
                "title": "Vacancy still open",
                "body": "No one is available",
                "sound": "default",
                "data": {"link": "/schedule"},
            }
        ]
    ]

    # Push trouble never breaks the action that caused it.
    def broken(request, timeout):
        raise OSError("offline")

    monkeypatch.setattr("urllib.request.urlopen", broken)
    assert len(notify("vacancy_unfilled", [officer], "Still recorded")) == 1


def with_email(user, address):
    user.email = address
    user.save(update_fields=["email"])
    return user


def test_emails_follow_the_department_rules_and_member_choices(client_for, admin_user, member, mailoutbox):
    with_email(member, "ff@example.com")
    # Defaults: mandatory overtime is emailed, an overtime offer isn't.
    notify("overtime_mandatory", [member], "You're working mandatory overtime Sat Oct 24", "Engineer seat", "/x")
    notify("overtime_offer", [member], "Overtime available Sat Oct 24")
    assert [m.subject for m in mailoutbox] == ["You're working mandatory overtime Sat Oct 24"]
    assert mailoutbox[0].to == ["ff@example.com"]
    assert "http://localhost:8000/x" in mailoutbox[0].body

    # The admin emails offers too; the member turns offer emails off, and can't turn off mandatory ones.
    rules = client_for(admin_user).get("/api/v1/notification-rules/").json()
    offer = next(r for r in rules if r["kind"] == "overtime_offer")
    assert (offer["push"], offer["email"], offer["required"]) == (True, False, False)
    response = client_for(admin_user).patch(
        "/api/v1/notification-rules/", [{"kind": "overtime_offer", "push": True, "email": True}], format="json"
    )
    assert next(r for r in response.json() if r["kind"] == "overtime_offer")["email"] is True
    mine = (
        client_for(member)
        .patch(
            "/api/v1/me/notifications/",
            [
                {"kind": "overtime_offer", "push": True, "email": False},
                {"kind": "overtime_mandatory", "push": False, "email": False},
            ],
            format="json",
        )
        .json()
    )
    by_kind = {r["kind"]: r for r in mine}
    assert (by_kind["overtime_offer"]["department_email"], by_kind["overtime_offer"]["email"]) == (True, False)
    assert (by_kind["overtime_mandatory"]["email"], by_kind["overtime_mandatory"]["required"]) == (True, True)

    mailoutbox.clear()
    notify("overtime_offer", [member], "Overtime available Sun Oct 25")
    notify("overtime_mandatory", [member], "You're working mandatory overtime Sun Oct 25")
    assert [m.subject for m in mailoutbox] == ["You're working mandatory overtime Sun Oct 25"]


def test_notification_rules_are_for_admins(client_for, officer, member):
    kinds = {r["kind"] for r in client_for(member).get("/api/v1/me/notifications/").json()}
    assert "overtime_offer" in kinds and "vacancy_unfilled" not in kinds  # officers' business
    assert "vacancy_unfilled" in {r["kind"] for r in client_for(officer).get("/api/v1/me/notifications/").json()}
    assert client_for(officer).get("/api/v1/notification-rules/").status_code == 403
    assert client_for(member).patch("/api/v1/notification-rules/", [], format="json").status_code == 403
    bad = [{"kind": "nope", "push": True, "email": True}]
    assert client_for(member).patch("/api/v1/me/notifications/", bad, format="json").status_code == 400


def test_officers_hear_about_new_leave_requests(client_for, member, officer, admin_user):
    response = client_for(member).post(
        "/api/v1/leave-requests/",
        {"leave_type": "vacation", "start_date": "2030-03-02", "end_date": "2030-03-04"},
        format="json",
    )
    assert response.status_code == 201, response.content
    told = set(Notification.objects.filter(title__startswith="Leave request from").values_list("user", flat=True))
    assert told == {officer.id, admin_user.id}
    assert Notification.objects.filter(user=officer, body="Vacation, Mar 2 – Mar 4").exists()


def test_certification_reminders_go_out_once_per_threshold(member, officer, mailoutbox):
    import datetime

    from apps.certifications.models import Certification, CertificationType
    from apps.notifications.reminders import certification_reminders

    with_email(member, "ff@example.com")
    with_email(officer, "cpt@example.com")
    emt = CertificationType.objects.create(department=member.department, name="EMT-B")
    today = datetime.date(2030, 1, 1)
    cert = Certification.objects.create(
        user=member, department=member.department, certification_type=emt, expires_on=today + datetime.timedelta(45)
    )
    Certification.objects.create(
        user=officer, department=member.department, certification_type=emt, expires_on=today + datetime.timedelta(200)
    )

    certification_reminders(today)
    certification_reminders(today)  # Running twice sends nothing new.
    assert Notification.objects.filter(user=member, title="Your EMT-B expires in 45 days").count() == 1
    assert Notification.objects.filter(user=officer, title="1 certification expiring soon").count() == 1
    assert sorted(m.to[0] for m in mailoutbox) == ["cpt@example.com", "ff@example.com"]

    # 25 days out: the 30-day reminder. Found 3 days out: only the 7-day one.
    certification_reminders(today + datetime.timedelta(20))
    assert Notification.objects.filter(user=member, title="Your EMT-B expires in 25 days").exists()
    cert.expires_on = today + datetime.timedelta(3)
    cert.save()
    certification_reminders(today)
    assert Notification.objects.filter(user=member, title="Your EMT-B expires in 3 days").exists()
