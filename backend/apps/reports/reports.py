"""Department reports. Each one is a table: columns plus rows of plain values, for the screen or CSV."""

import datetime
from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.apparatus.models import Apparatus, Inspection, MaintenanceSchedule, ServiceRecord, WorkOrder
from apps.core.models import User
from apps.events.models import Attendance
from apps.inventory.models import Item, StockLevel, StockTransaction
from apps.scheduling.models import LeaveRequest


class Report:
    slug = ""
    title = ""
    description = ""
    uses_dates = True
    columns: list[tuple[str, str]] = []

    def __init__(self, department, start, end):
        self.department = department
        self.start = start
        self.end = end

    def rows(self) -> list[dict]:
        raise NotImplementedError

    def as_dict(self):
        return {
            "slug": self.slug,
            "title": self.title,
            "start": self.start if self.uses_dates else None,
            "end": self.end if self.uses_dates else None,
            "columns": [{"key": k, "label": label} for k, label in self.columns],
            "rows": self.rows(),
        }


def _to_aware(date, end_of_day=False):
    time = datetime.time.max if end_of_day else datetime.time.min
    return timezone.make_aware(datetime.datetime.combine(date, time))


def _merged_days(intervals, start, end):
    """Total days covered by (start, end) datetime intervals, clipped to the range, overlaps counted once."""
    clipped = sorted((max(a, start), min(b, end)) for a, b in intervals if b > start and a < end)
    total = datetime.timedelta()
    current = None
    for a, b in clipped:
        if current and a <= current[1]:
            current = (current[0], max(current[1], b))
        else:
            if current:
                total += current[1] - current[0]
            current = (a, b)
    if current:
        total += current[1] - current[0]
    return round(total.total_seconds() / 86400, 1)


class FleetReport(Report):
    slug = "fleet"
    title = "Fleet"
    description = "Rig checks, out-of-service time, repairs and maintenance cost per apparatus."
    columns = [
        ("unit", "Unit"),
        ("type", "Type"),
        ("station", "Station"),
        ("days_checked", "Days checked"),
        ("check_rate", "Check rate %"),
        ("deficiencies", "Deficiencies found"),
        ("work_orders_opened", "Work orders opened"),
        ("work_orders_completed", "Work orders completed"),
        ("out_of_service_days", "Out-of-service days"),
        ("repair_cost", "Repair cost"),
        ("maintenance_cost", "Maintenance cost"),
        ("mileage", "Current mileage"),
    ]

    def rows(self):
        start_dt, end_dt = _to_aware(self.start), _to_aware(self.end, end_of_day=True)
        days_in_range = (self.end - self.start).days + 1
        now = timezone.now()
        rows = []
        for rig in Apparatus.objects.filter(department=self.department).select_related("station"):
            inspections = Inspection.objects.filter(apparatus=rig, performed_at__range=(start_dt, end_dt))
            days_checked = len({timezone.localtime(i.performed_at).date() for i in inspections.only("performed_at")})
            deficiencies = inspections.filter(results__status="deficient").count()
            orders = WorkOrder.objects.filter(apparatus=rig)
            oos = [
                (o.created_at, o.completed_at or (o.updated_at if o.status == "cancelled" else now))
                for o in orders.filter(takes_out_of_service=True)
            ]
            repair = orders.filter(completed_at__range=(start_dt, end_dt)).aggregate(t=Sum("cost"))["t"] or Decimal(0)
            maintenance = ServiceRecord.objects.filter(
                apparatus=rig, performed_on__range=(self.start, self.end)
            ).aggregate(t=Sum("cost"))["t"] or Decimal(0)
            rows.append(
                {
                    "unit": rig.unit_number,
                    "type": rig.get_apparatus_type_display(),
                    "station": str(rig.station) if rig.station else "",
                    "days_checked": days_checked,
                    "check_rate": round(100 * days_checked / days_in_range),
                    "deficiencies": deficiencies,
                    "work_orders_opened": orders.filter(created_at__range=(start_dt, end_dt)).count(),
                    "work_orders_completed": orders.filter(completed_at__range=(start_dt, end_dt)).count(),
                    "out_of_service_days": _merged_days(oos, start_dt, min(end_dt, now)),
                    "repair_cost": repair,
                    "maintenance_cost": maintenance,
                    "mileage": rig.mileage,
                }
            )
        return rows


class InventoryUsageReport(Report):
    slug = "inventory-usage"
    title = "Inventory usage"
    description = "What was used, restocked and written off, per item, with what's on hand now."
    columns = [
        ("item", "Item"),
        ("category", "Category"),
        ("unit", "Unit"),
        ("used", "Used"),
        ("restocked", "Restocked"),
        ("written_off", "Expired / damaged"),
        ("on_hand", "On hand now"),
        ("par", "Total par"),
    ]

    def rows(self):
        moves = (
            StockTransaction.objects.filter(
                department=self.department, created_at__range=(_to_aware(self.start), _to_aware(self.end, True))
            )
            .values("stock__item")
            .annotate(
                used=Sum("change", filter=Q(reason="used")),
                restocked=Sum("change", filter=Q(reason="restock")),
                written_off=Sum("change", filter=Q(reason__in=["expired", "damaged"])),
            )
        )
        by_item = {m["stock__item"]: m for m in moves}
        totals = (
            StockLevel.objects.filter(department=self.department)
            .values("item", "item__name", "item__category", "item__unit")
            .annotate(on_hand=Sum("quantity"), par=Sum("par_level"))
            .order_by("item__name")
        )
        rows = []
        for t in totals:
            m = by_item.get(t["item"], {})
            rows.append(
                {
                    "item": t["item__name"],
                    "category": Item.Category(t["item__category"]).label,
                    "unit": t["item__unit"],
                    "used": -(m.get("used") or 0),
                    "restocked": m.get("restocked") or 0,
                    "written_off": -(m.get("written_off") or 0),
                    "on_hand": t["on_hand"],
                    "par": t["par"],
                }
            )
        return rows


class TrainingReport(Report):
    slug = "training"
    title = "Training hours"
    description = "Credit hours per member from attended events, by type, plus mandatory events missed."
    columns = [
        ("member", "Member"),
        ("employee_id", "Employee ID"),
        ("training", "Training"),
        ("drill", "Drill"),
        ("other", "Other"),
        ("total", "Total hours"),
        ("mandatory_missed", "Mandatory events missed"),
    ]

    def rows(self):
        in_range = Q(event__starts_at__range=(_to_aware(self.start), _to_aware(self.end, True)))
        hours = defaultdict(lambda: defaultdict(Decimal))
        for a in Attendance.objects.filter(
            in_range, event__department=self.department, status="attended", event__training_hours__isnull=False
        ).values("user", "event__category", "event__training_hours"):
            bucket = a["event__category"] if a["event__category"] in ("training", "drill") else "other"
            hours[a["user"]][bucket] += a["event__training_hours"]
        missed = dict(
            Attendance.objects.filter(
                in_range,
                event__department=self.department,
                event__is_mandatory=True,
                event__ends_at__lt=timezone.now(),
            )
            .exclude(status="attended")
            .values_list("user")
            .annotate(n=Count("id"))
        )
        rows = []
        for user in User.objects.filter(department=self.department, is_active=True).order_by("last_name", "first_name"):
            h = hours[user.id]
            rows.append(
                {
                    "member": str(user),
                    "employee_id": user.employee_id,
                    "training": h["training"],
                    "drill": h["drill"],
                    "other": h["other"],
                    "total": h["training"] + h["drill"] + h["other"],
                    "mandatory_missed": missed.get(user.id, 0),
                }
            )
        return rows


class LeaveReport(Report):
    slug = "leave"
    title = "Leave taken"
    description = "Approved leave days per member within the range, by type."
    columns = (
        [("member", "Member"), ("employee_id", "Employee ID")]
        + [(value, label) for value, label in LeaveRequest.LeaveType.choices]
        + [("total", "Total days")]
    )

    def rows(self):
        days = defaultdict(lambda: defaultdict(int))
        for leave in LeaveRequest.objects.filter(
            department=self.department, status="approved", start_date__lte=self.end, end_date__gte=self.start
        ):
            overlap = (min(leave.end_date, self.end) - max(leave.start_date, self.start)).days + 1
            days[leave.user_id][leave.leave_type] += overlap
        rows = []
        for user in User.objects.filter(department=self.department, is_active=True).order_by("last_name", "first_name"):
            d = days[user.id]
            row = {"member": str(user), "employee_id": user.employee_id}
            row.update({value: d[value] for value, _ in LeaveRequest.LeaveType.choices})
            row["total"] = sum(d.values())
            rows.append(row)
        return rows


class MaintenanceReport(Report):
    slug = "maintenance"
    title = "Maintenance status"
    description = "Every preventive maintenance task and test, and when it's due. A snapshot as of today."
    uses_dates = False
    columns = [
        ("unit", "Unit"),
        ("task", "Task"),
        ("last_done", "Last done"),
        ("next_due_date", "Due date"),
        ("next_due_mileage", "Due mileage"),
        ("status", "Status"),
    ]

    def rows(self):
        today = timezone.localdate()
        rows = []
        for s in MaintenanceSchedule.objects.filter(department=self.department).select_related("apparatus"):
            overdue = s.is_due(on_date=today)
            soon = not overdue and s.is_due(on_date=today, warning_days=30)
            rows.append(
                {
                    "unit": s.apparatus.unit_number,
                    "task": s.task,
                    "last_done": s.last_performed_on,
                    "next_due_date": s.next_due_date,
                    "next_due_mileage": s.next_due_mileage,
                    "status": "Due" if overdue else "Due within 30 days" if soon else "OK",
                }
            )
        return sorted(rows, key=lambda r: ({"Due": 0, "Due within 30 days": 1, "OK": 2}[r["status"]], r["unit"]))


REPORTS = {cls.slug: cls for cls in (FleetReport, InventoryUsageReport, TrainingReport, LeaveReport, MaintenanceReport)}
