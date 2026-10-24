import datetime
from decimal import Decimal

from django.utils import timezone

from apps.apparatus.models import Apparatus, ChecklistTemplate, Inspection, ServiceRecord, WorkOrder
from apps.events.models import Attendance, Event
from apps.inventory.models import Item, StockLevel, StorageLocation
from apps.reports.reports import _merged_days
from apps.scheduling.models import LeaveRequest

D = datetime.date(2026, 3, 1)


def at(date, hour=12):
    return timezone.make_aware(datetime.datetime.combine(date, datetime.time(hour)))


def report(client, slug, **params):
    response = client.get(f"/api/v1/reports/{slug}/", params)
    assert response.status_code == 200, response.content
    return response.json()


def test_merged_days_counts_overlap_once():
    start, end = at(D, 0), at(D + datetime.timedelta(days=10), 0)
    intervals = [
        (at(D - datetime.timedelta(days=3)), at(D + datetime.timedelta(days=1))),  # clipped at start: 1.5 days
        (at(D + datetime.timedelta(days=2)), at(D + datetime.timedelta(days=4))),  # 2 days
        (at(D + datetime.timedelta(days=3)), at(D + datetime.timedelta(days=5))),  # overlaps: +1 day
    ]
    assert _merged_days(intervals, start, end) == 4.5


def test_fleet(client_for, officer, member, department):
    rig = Apparatus.objects.create(department=department, unit_number="E1", apparatus_type="engine", mileage=100)
    template = ChecklistTemplate.objects.create(department=department, name="Daily")
    for day in (D, D, D + datetime.timedelta(days=1)):  # two checks on the first day count once
        Inspection.objects.create(
            department=department, apparatus=rig, template=template, performed_by=member, performed_at=at(day)
        )
    order = WorkOrder.objects.create(
        department=department, apparatus=rig, title="Pump", takes_out_of_service=True, cost=Decimal("250")
    )
    WorkOrder.objects.filter(pk=order.pk).update(
        created_at=at(D), completed_at=at(D + datetime.timedelta(days=2)), status="completed"
    )
    ServiceRecord.objects.create(
        department=department, apparatus=rig, description="Oil", performed_on=D, cost=Decimal("80")
    )

    end = D + datetime.timedelta(days=9)
    [row] = report(client_for(officer), "fleet", start=D, end=end)["rows"]
    assert row["days_checked"] == 2
    assert row["check_rate"] == 20
    assert row["work_orders_opened"] == 1
    assert row["work_orders_completed"] == 1
    assert row["out_of_service_days"] == 2.0
    assert Decimal(row["repair_cost"]) == 250
    assert Decimal(row["maintenance_cost"]) == 80


def test_inventory_usage(client_for, officer, department, station):
    location = StorageLocation.objects.create(department=department, name="Closet", station=station)
    gauze = Item.objects.create(department=department, name="Gauze", unit="pack")
    stock = StockLevel.objects.create(department=department, item=gauze, location=location, par_level=10)
    stock.adjust(20, "restock", officer)
    stock.adjust(-6, "used", officer)
    stock.adjust(-2, "expired", officer)
    today = timezone.localdate()
    [row] = report(client_for(officer), "inventory-usage", start=today, end=today)["rows"]
    assert (row["used"], row["restocked"], row["written_off"], row["on_hand"], row["par"]) == (6, 20, 2, 12, 10)
    assert row["category"] == "Station & other supplies"


def test_training(client_for, officer, member, department):
    def event(category, hours, mandatory=False, day=D):
        return Event.objects.create(
            department=department,
            title=category,
            category=category,
            training_hours=hours,
            is_mandatory=mandatory,
            starts_at=at(day, 9),
            ends_at=at(day, 11),
        )

    Attendance.objects.create(event=event("training", 3), user=member, status="attended")
    Attendance.objects.create(event=event("drill", 2), user=member, status="attended")
    Attendance.objects.create(event=event("meeting", 1), user=member, status="attended")
    Attendance.objects.create(event=event("training", 4, mandatory=True), user=member, status="absent")
    rows = {r["member"]: r for r in report(client_for(officer), "training", start=D, end=D)["rows"]}
    row = rows[str(member)]
    assert (Decimal(row["training"]), Decimal(row["drill"]), Decimal(row["other"]), Decimal(row["total"])) == (
        3,
        2,
        1,
        6,
    )
    assert row["mandatory_missed"] == 1


def test_leave_is_clipped_to_the_range(client_for, officer, member, department):
    LeaveRequest.objects.create(
        department=department,
        user=member,
        leave_type="vacation",
        status="approved",
        start_date=D - datetime.timedelta(days=2),
        end_date=D + datetime.timedelta(days=1),
    )
    LeaveRequest.objects.create(
        department=department, user=member, leave_type="sick", status="pending", start_date=D, end_date=D
    )
    rows = {
        r["member"]: r
        for r in report(client_for(officer), "leave", start=D, end=D + datetime.timedelta(days=30))["rows"]
    }
    assert rows[str(member)]["vacation"] == 2
    assert rows[str(member)]["sick"] == 0
    assert rows[str(member)]["total"] == 2


def test_csv_export(client_for, officer, department):
    Apparatus.objects.create(department=department, unit_number="E1", apparatus_type="engine")
    response = client_for(officer).get("/api/v1/reports/fleet/", {"start": D, "end": D, "export": "csv"})
    assert response["Content-Type"].startswith("text/csv")
    assert 'filename="firefirst-fleet-2026-03-01-to-2026-03-01.csv"' in response["Content-Disposition"]
    text = response.content.decode("utf-8")
    assert text.startswith("﻿Unit,Type,Station,Days checked")
    assert "\nE1,Engine," in text


def test_maintenance_snapshot_and_listing(client_for, officer):
    assert report(client_for(officer), "maintenance")["start"] is None
    slugs = [r["slug"] for r in client_for(officer).get("/api/v1/reports/").json()]
    assert slugs == ["fleet", "inventory-usage", "training", "leave", "maintenance"]


def test_reports_are_officer_only_and_scoped(client_for, member, officer, other_department):
    assert client_for(member).get("/api/v1/reports/fleet/").status_code == 403
    Apparatus.objects.create(department=other_department, unit_number="X1", apparatus_type="engine")
    assert report(client_for(officer), "fleet")["rows"] == []


def test_bad_ranges(client_for, officer):
    client = client_for(officer)
    assert client.get("/api/v1/reports/fleet/", {"start": "2026-03-02", "end": "2026-03-01"}).status_code == 400
    assert client.get("/api/v1/reports/nope/").status_code == 404
