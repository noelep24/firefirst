"""Every kind of notification FireFirst sends, who gets it, and how it goes out unless the department says otherwise.

Each goes to the in-app list. The department turns phone push and email on or off for each kind, and members
can turn off the ones that aren't required.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Kind:
    key: str
    label: str
    audience: str
    push: bool = True
    email: bool = False
    # Required notices can't be turned off by the member (the department still chooses how they go out).
    required: bool = False
    # Only officers get it, so members don't see it among their choices.
    officers_only: bool = False


KINDS = [
    Kind("overtime_offer", "Overtime offered", "Members offered a vacancy"),
    Kind("overtime_mandatory", "Mandatory overtime", "The member hired", email=True, required=True),
    Kind("overtime_voluntary", "Volunteered overtime confirmed", "The member hired"),
    Kind("overtime_withdrawn", "Overtime no longer needed", "Members who were offered it"),
    Kind("vacancy_filled", "Vacancy filled", "The officer who posted it", officers_only=True),
    Kind("vacancy_unfilled", "Vacancy nobody could fill", "Officers", email=True, required=True, officers_only=True),
    Kind("leave_waiting", "Leave request waiting", "Officers", officers_only=True),
    Kind("certification_expiring", "Certification expiring", "The member and officers", email=True),
]

BY_KEY = {kind.key: kind for kind in KINDS}

# Days before expiry that certification reminders go out.
CERTIFICATION_REMINDER_DAYS = (60, 30, 7)
