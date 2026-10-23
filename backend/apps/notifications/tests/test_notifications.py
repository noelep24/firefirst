import json

from apps.notifications.models import Notification, PushDevice
from apps.notifications.send import notify

TOKEN = "ExponentPushToken[abc123]"


def test_members_see_and_clear_their_own_notifications(client_for, member, officer):
    notify([member], "Overtime available Sat Oct 24", "Engineer seat", "/schedule")
    notify([officer], "For someone else")
    client = client_for(member)
    rows = client.get("/api/v1/notifications/").json()["results"]
    assert [(r["title"], r["read_at"]) for r in rows] == [("Overtime available Sat Oct 24", None)]
    assert client.post(f"/api/v1/notifications/{rows[0]['id']}/read/").json()["read_at"]
    notify([member], "Another")
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
    notify([officer], "Vacancy still open", "No one is available", "/schedule")
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
    assert len(notify([officer], "Still recorded")) == 1
