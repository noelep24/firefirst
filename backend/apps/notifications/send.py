"""Tell members about things: always in the apps, and by phone push and email as the department and member choose."""

import json
import logging
import urllib.request

from django.conf import settings
from django.core.mail import send_mass_mail

from .kinds import BY_KEY
from .models import Notification, NotificationOptOut, NotificationRule, PushDevice

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def channels(department, kind):
    """(push, email) for a kind of notification in a department: its rule, or the kind's defaults."""
    rule = NotificationRule.objects.filter(department=department, kind=kind).first()
    default = BY_KEY[kind]
    return (rule.push, rule.email) if rule else (default.push, default.email)


def notify(kind, users, title, body="", link=""):
    """Record a notification for each user, then push and email it as configured. Delivery problems never fail
    the caller."""
    users = [u for u in users if u is not None]
    if not users:
        return []
    created = Notification.objects.bulk_create(
        [Notification(department=u.department, user=u, title=title, body=body, link=link) for u in users]
    )
    push, email = channels(users[0].department, kind)
    required = BY_KEY[kind].required
    opted_out = {} if required else {o.user_id: o for o in NotificationOptOut.objects.filter(user__in=users, kind=kind)}

    if push and settings.PUSH_NOTIFICATIONS_ENABLED:
        wanted = [u for u in users if not (u.id in opted_out and opted_out[u.id].push)]
        tokens = list(PushDevice.objects.filter(user__in=wanted).values_list("token", flat=True))
        if tokens:
            _push(tokens, title, body, link)
    if email:
        recipients = [u for u in users if u.email and not (u.id in opted_out and opted_out[u.id].email)]
        if recipients:
            _email(recipients, title, body, link)
    return created


def _email(users, title, body, link):
    url = f"{settings.APP_URL.rstrip('/')}{link}" if link else settings.APP_URL
    text = f"{body}\n\nOpen FireFirst: {url}\n" if body else f"Open FireFirst: {url}\n"
    footer = "\n—\nYou can change which emails you get under your name › Notifications in FireFirst.\n"
    messages = [(title, text + footer, None, [u.email]) for u in users]
    try:
        send_mass_mail(messages, fail_silently=False)
    except Exception:
        log.warning("Notification email failed", exc_info=True)


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
