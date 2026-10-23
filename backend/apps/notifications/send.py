"""Tell members about things, in the apps and by push notification to their phones."""

import json
import logging
import urllib.request

from django.conf import settings

from .models import Notification, PushDevice

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def notify(users, title, body="", link=""):
    """Record a notification for each user and push it to their phones. Push failures never fail the caller."""
    users = [u for u in users if u is not None]
    if not users:
        return []
    created = Notification.objects.bulk_create(
        [Notification(department=u.department, user=u, title=title, body=body, link=link) for u in users]
    )
    tokens = list(PushDevice.objects.filter(user__in=users).values_list("token", flat=True))
    if tokens and settings.PUSH_NOTIFICATIONS_ENABLED:
        _push(tokens, title, body, link)
    return created


def _push(tokens, title, body, link):
    messages = [{"to": t, "title": title, "body": body, "sound": "default", "data": {"link": link}} for t in tokens]
    for start in range(0, len(messages), 100):  # Expo takes up to 100 per request.
        request = urllib.request.Request(
            EXPO_PUSH_URL,
            data=json.dumps(messages[start : start + 100]).encode(),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            urllib.request.urlopen(request, timeout=5).close()
        except OSError:
            log.warning("Push notification failed", exc_info=True)
