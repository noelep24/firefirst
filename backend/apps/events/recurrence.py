"""Expand a repeating event into its occurrences.

Repeats are computed in the department's local time, so a 7 PM meeting stays
at 7 PM across daylight-saving changes.
"""

import calendar
import datetime
from zoneinfo import ZoneInfo

from apps.certifications.models import add_months

MAX_OCCURRENCES = 104

WEEKLY = "weekly"
MONTHLY_DATE = "monthly_date"  # the 15th of every month
MONTHLY_WEEKDAY = "monthly_weekday"  # the 2nd Tuesday of every month (or the last one)

FREQUENCIES = [
    ("none", "Doesn't repeat"),
    (WEEKLY, "Weekly"),
    (MONTHLY_DATE, "Monthly on the same date"),
    (MONTHLY_WEEKDAY, "Monthly on the same weekday (e.g. 2nd Tuesday)"),
]


def nth_weekday(year, month, weekday, n):
    """Date of the n-th ``weekday`` (Mon=0) in a month; n=-1 is the last one."""
    days = [d for d in calendar.Calendar().itermonthdates(year, month) if d.month == month and d.weekday() == weekday]
    return days[-1] if n == -1 else days[n - 1]


def occurrence_dates(first, frequency, interval=1, until=None, count=None):
    """Local dates of every occurrence, starting with ``first``."""
    if until is None and count is None:
        raise ValueError("Give an end date or a number of occurrences.")
    limit = min(count or MAX_OCCURRENCES, MAX_OCCURRENCES)
    # Which week of the month the first date falls in; the 5th week means "last".
    week = (first.day - 1) // 7 + 1
    nth = -1 if week == 5 else week
    dates = []
    step = 0
    while len(dates) < limit:
        if frequency == WEEKLY:
            date = first + datetime.timedelta(weeks=step * interval)
        elif frequency == MONTHLY_DATE:
            date = add_months(first, step * interval)
        elif frequency == MONTHLY_WEEKDAY:
            month_start = add_months(first.replace(day=1), step * interval)
            date = nth_weekday(month_start.year, month_start.month, first.weekday(), nth)
        else:
            raise ValueError(f"Unknown frequency {frequency!r}.")
        if until and date > until:
            break
        dates.append(date)
        step += 1
    return dates


def occurrence_starts(starts_at, tz_name, frequency, interval=1, until=None, count=None):
    """Aware start datetimes for each occurrence, keeping the local wall-clock time."""
    tz = ZoneInfo(tz_name)
    local = starts_at.astimezone(tz)
    return [
        datetime.datetime.combine(date, local.time(), tzinfo=tz)
        for date in occurrence_dates(local.date(), frequency, interval, until, count)
    ]
