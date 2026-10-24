"""Who hears about rig checks and repairs."""

from django.utils import timezone

from apps.core.models import User
from apps.notifications.send import notify
from apps.scheduling.models import Assignment
from apps.scheduling.roster import build_roster

from .models import InspectionResult

OFFICER_SEATS = [Assignment.Position.CAPTAIN, Assignment.Position.LIEUTENANT]


def station_captains(apparatus, date):
    """The captains (and lieutenants) on duty at the rig's station that day; failing that, every one assigned there."""
    if apparatus.station_id is None:
        return []
    working = build_roster(apparatus.department, date)["working"]
    on_duty = [p["user"] for p in working if p["station"] == apparatus.station_id and p["position"] in OFFICER_SEATS]
    if not on_duty:
        on_duty = Assignment.objects.filter(
            station_id=apparatus.station_id, position__in=OFFICER_SEATS, user__is_active=True
        ).values_list("user_id", flat=True)
    return list(User.objects.filter(id__in=on_duty))


def rig_check_completed(inspection):
    """Tell the station's captains a rig check is done, with anything found wrong, and tell admins about any work
    orders it opened."""
    rig = inspection.apparatus
    problems = list(
        inspection.results.filter(status=InspectionResult.Status.DEFICIENT).select_related("checklist_item")
    )
    lines = [f"Done by {inspection.performed_by} using {inspection.template}."]
    if inspection.mileage is not None:
        lines.append(f"Mileage {inspection.mileage:,}.")
    if problems:
        lines.append("Problems found:")
        lines += [f"• {r.checklist_item.prompt}: {r.note}" for r in problems]
    else:
        lines.append("Everything passed.")
    if inspection.notes:
        lines.append(f"Notes: {inspection.notes}")
    verdict = f"{len(problems)} problem{'s' if len(problems) != 1 else ''}" if problems else "all passed"
    notify(
        "rig_check_completed",
        station_captains(rig, timezone.localdate()),
        f"{rig.unit_number} rig check done: {verdict}",
        "\n".join(lines),
        f"/apparatus/{rig.id}",
    )
    work_orders_opened(list(inspection.work_orders.all()))


def work_orders_opened(work_orders):
    """Tell the department's admins about new work orders: one notice, however many a rig check opened."""
    if not work_orders:
        return
    department = work_orders[0].department
    admins = User.objects.filter(department=department, role=User.Role.ADMIN, is_active=True)
    if len(work_orders) == 1:
        w = work_orders[0]
        title = f"New work order: {w.apparatus.unit_number} – {w.title}"
        body = f"{w.get_priority_display()} priority"
        body += ", rig taken out of service" if w.takes_out_of_service else ""
        body += f". Reported by {w.reported_by}." if w.reported_by else "."
        if w.description:
            body += f"\n{w.description}"
    else:
        rig = work_orders[0].apparatus
        title = f"{len(work_orders)} new work orders on {rig.unit_number}"
        body = "\n".join(f"• {w.title}" for w in work_orders)
    notify("work_order_new", admins, title, body, "/work-orders")
