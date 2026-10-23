"""A personal iCalendar (RFC 5545) feed: the member's shifts and department events."""

import datetime
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils import timezone

from apps.scheduling.models import RotationPattern
from apps.scheduling.roster import member_shifts

from .models import Event

PAST_DAYS = 30
FUTURE_DAYS = 180
CRLF = "\r\n"


def _escape(text):
    return str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    """Lines longer than 75 octets continue on the next line after a space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts = []
    while raw:
        cut = 75 if not parts else 74
        # Don't split a UTF-8 character.
        while cut < len(raw) and (raw[cut] & 0xC0) == 0x80:
            cut -= 1
        parts.append(raw[:cut].decode("utf-8"))
        raw = raw[cut:]
    return (CRLF + " ").join(parts)


def _utc(dt):
    return dt.astimezone(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")


def build_feed(user):
    department = user.department
    today = timezone.localdate()
    start, end = today - datetime.timedelta(days=PAST_DAYS), today + datetime.timedelta(days=FUTURE_DAYS)
    stamp = _utc(timezone.now())
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//FireFirst//Station calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(f'FireFirst – {department.name}')}",
        f"X-WR-TIMEZONE:{department.timezone}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]

    pattern = RotationPattern.active_for(department)
    if pattern is not None:
        tz = ZoneInfo(department.timezone)
        for day, note in member_shifts(user, start, end):
            begins = datetime.datetime.combine(day, pattern.shift_start, tzinfo=tz)
            lines += [
                "BEGIN:VEVENT",
                f"UID:shift-{user.id}-{day.isoformat()}@firefirst",
                f"DTSTAMP:{stamp}",
                f"DTSTART:{_utc(begins)}",
                f"DTEND:{_utc(begins + datetime.timedelta(hours=pattern.shift_hours))}",
                f"SUMMARY:{_escape('On duty' + (f' ({note})' if note else ''))}",
                "TRANSP:OPAQUE",
                "END:VEVENT",
            ]

    # Department-wide events, events at their station, and anything they're invited to.
    events = (
        Event.objects.filter(department=department, ends_at__date__gte=start, starts_at__date__lte=end)
        .filter(Q(station__isnull=True) | Q(station=user.home_station_id) | Q(attendance__user=user))
        .select_related("station")
        .distinct()
    )
    for event in events:
        lines += ["BEGIN:VEVENT", f"UID:event-{event.id}@firefirst", f"DTSTAMP:{stamp}"]
        if event.all_day:
            first = timezone.localtime(event.starts_at).date()
            last = timezone.localtime(event.ends_at).date() + datetime.timedelta(days=1)
            lines += [f"DTSTART;VALUE=DATE:{first:%Y%m%d}", f"DTEND;VALUE=DATE:{last:%Y%m%d}"]
        else:
            lines += [f"DTSTART:{_utc(event.starts_at)}", f"DTEND:{_utc(event.ends_at)}"]
        summary = event.title + (" (mandatory)" if event.is_mandatory else "")
        lines.append(f"SUMMARY:{_escape(summary)}")
        location = event.location or (str(event.station) if event.station else "")
        if location:
            lines.append(f"LOCATION:{_escape(location)}")
        if event.description:
            lines.append(f"DESCRIPTION:{_escape(event.description)}")
        lines += [f"CATEGORIES:{_escape(event.get_category_display())}", "END:VEVENT"]

    lines.append("END:VCALENDAR")
    return CRLF.join(_fold(line) for line in lines) + CRLF
