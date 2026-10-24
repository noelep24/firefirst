import datetime

import pytest

from apps.apparatus.models import (
    Apparatus,
    ChecklistItem,
    ChecklistTemplate,
    MaintenanceSchedule,
    WorkOrder,
)


@pytest.fixture
def engine(department, station):
    return Apparatus.objects.create(
        department=department, unit_number="E1", apparatus_type="engine", station=station, mileage=10_000
    )


@pytest.fixture
def checklist(department):
    template = ChecklistTemplate.objects.create(department=department, name="Engine daily", apparatus_type="engine")
    for i, prompt in enumerate(["Fuel at least 3/4", "Lights and sirens", "SCBA bottles full"]):
        ChecklistItem.objects.create(template=template, prompt=prompt, order=i)
    return template


def inspection_payload(engine, checklist, deficient_note=None, **extra):
    items = list(checklist.items.all())
    results = [{"checklist_item": i.id, "status": "ok"} for i in items]
    if deficient_note:
        results[1] = {"checklist_item": items[1].id, "status": "deficient", "note": deficient_note}
    return {"apparatus": engine.id, "template": checklist.id, "results": results, **extra}


def test_create_checklist_with_items(client_for, officer):
    response = client_for(officer).post(
        "/api/v1/checklists/",
        {"name": "Weekly SCBA", "items": [{"prompt": "Cylinder pressure"}, {"prompt": "Facepiece seal"}]},
        format="json",
    )
    assert response.status_code == 201
    assert [i["order"] for i in response.json()["items"]] == [0, 1]


def test_member_logs_rig_check_and_deficiency_opens_work_order(client_for, member, engine, checklist):
    response = client_for(member).post(
        "/api/v1/inspections/",
        inspection_payload(engine, checklist, "Driver side light out", mileage=10_120),
        format="json",
    )
    assert response.status_code == 201, response.json()
    assert response.json()["deficiency_count"] == 1
    order = WorkOrder.objects.get()
    assert order.title == "Lights and sirens"
    assert order.description == "Driver side light out"
    assert order.reported_by == member
    engine.refresh_from_db()
    assert engine.mileage == 10_120


def test_deficient_items_need_a_note(client_for, member, engine, checklist):
    payload = inspection_payload(engine, checklist)
    payload["results"][0]["status"] = "deficient"
    assert client_for(member).post("/api/v1/inspections/", payload, format="json").status_code == 400


def test_inspection_rejects_items_from_another_checklist(client_for, member, department, engine, checklist):
    other = ChecklistTemplate.objects.create(department=department, name="Other")
    stray = ChecklistItem.objects.create(template=other, prompt="Not on this form")
    payload = inspection_payload(engine, checklist)
    payload["results"].append({"checklist_item": stray.id, "status": "ok"})
    assert client_for(member).post("/api/v1/inspections/", payload, format="json").status_code == 400


def test_inspections_cannot_be_edited(client_for, member, engine, checklist):
    client = client_for(member)
    created = client.post("/api/v1/inspections/", inspection_payload(engine, checklist), format="json").json()
    assert client.patch(f"/api/v1/inspections/{created['id']}/", {"notes": "x"}, format="json").status_code == 405


def test_out_of_service_work_order_controls_status(client_for, member, engine):
    client = client_for(member)
    created = client.post(
        "/api/v1/work-orders/",
        {"apparatus": engine.id, "title": "Pump won't engage", "priority": "critical", "takes_out_of_service": True},
        format="json",
    ).json()
    engine.refresh_from_db()
    assert engine.status == Apparatus.Status.OUT_OF_SERVICE

    done = client.patch(
        f"/api/v1/work-orders/{created['id']}/", {"status": "completed", "resolution": "Replaced PTO"}, format="json"
    ).json()
    assert done["completed_at"] is not None
    engine.refresh_from_db()
    assert engine.status == Apparatus.Status.IN_SERVICE


def test_rig_stays_oos_while_any_oos_order_is_open(department, engine):
    first = WorkOrder.objects.create(department=department, apparatus=engine, title="A", takes_out_of_service=True)
    WorkOrder.objects.create(department=department, apparatus=engine, title="B", takes_out_of_service=True)
    first.status = WorkOrder.Status.COMPLETED
    first.save()
    engine.refresh_from_db()
    assert engine.status == Apparatus.Status.OUT_OF_SERVICE


def test_reserve_rig_is_not_put_in_service_by_unrelated_order(department, engine):
    engine.status = Apparatus.Status.RESERVE
    engine.save()
    WorkOrder.objects.create(department=department, apparatus=engine, title="Wipers", status="completed")
    engine.refresh_from_db()
    assert engine.status == Apparatus.Status.RESERVE


def test_maintenance_due_by_date_and_mileage(department, engine):
    today = datetime.date(2026, 10, 1)
    by_date = MaintenanceSchedule.objects.create(
        department=department,
        apparatus=engine,
        task="Annual pump test",
        interval_days=365,
        last_performed_on=datetime.date(2025, 10, 10),
    )
    assert not by_date.is_due(on_date=today)
    assert by_date.is_due(on_date=today, warning_days=14)

    by_miles = MaintenanceSchedule.objects.create(
        department=department,
        apparatus=engine,
        task="Oil change",
        interval_miles=5_000,
        last_performed_on=today,
        last_mileage=6_000,
    )
    assert not by_miles.is_due(on_date=today)  # due at 11,000; rig is at 10,000
    by_miles.last_mileage = 4_000
    assert by_miles.is_due(on_date=today)


def test_never_performed_is_due(department, engine):
    schedule = MaintenanceSchedule.objects.create(
        department=department, apparatus=engine, task="Ladder test", interval_days=365
    )
    assert schedule.is_due()


def test_service_record_resets_schedule(client_for, officer, department, engine):
    schedule = MaintenanceSchedule.objects.create(
        department=department,
        apparatus=engine,
        task="Oil change",
        interval_miles=5_000,
        last_mileage=4_000,
        last_performed_on=datetime.date(2026, 1, 1),
    )
    client = client_for(officer)
    assert [s["id"] for s in client.get("/api/v1/maintenance-schedules/due/").json()] == [schedule.id]

    response = client.post(
        "/api/v1/service-records/",
        {"apparatus": engine.id, "schedule": schedule.id, "description": "Oil and filter", "mileage": 10_250},
        format="json",
    )
    assert response.status_code == 201, response.json()
    schedule.refresh_from_db()
    assert schedule.last_mileage == 10_250
    assert client.get("/api/v1/maintenance-schedules/due/").json() == []


def test_service_record_schedule_must_match_apparatus(client_for, officer, department, engine):
    other = Apparatus.objects.create(department=department, unit_number="M1", apparatus_type="ambulance")
    schedule = MaintenanceSchedule.objects.create(department=department, apparatus=other, task="x", interval_days=30)
    response = client_for(officer).post(
        "/api/v1/service-records/",
        {"apparatus": engine.id, "schedule": schedule.id, "description": "x"},
        format="json",
    )
    assert response.status_code == 400


def test_schedule_needs_an_interval(client_for, officer, engine):
    response = client_for(officer).post(
        "/api/v1/maintenance-schedules/", {"apparatus": engine.id, "task": "x"}, format="json"
    )
    assert response.status_code == 400


def test_checklists_for_apparatus_filters_by_type(client_for, member, department, engine, checklist):
    ChecklistTemplate.objects.create(department=department, name="Ambulance daily", apparatus_type="ambulance")
    ChecklistTemplate.objects.create(department=department, name="Any rig weekly")
    names = {t["name"] for t in client_for(member).get(f"/api/v1/apparatus/{engine.id}/checklists/").json()}
    assert names == {"Engine daily", "Any rig weekly"}


def test_work_orders_filter_by_station(client_for, member, department, engine):
    from apps.apparatus.models import WorkOrder
    from apps.core.models import Station

    north = Station.objects.create(department=department, number="2", name="Northside")
    e2 = Apparatus.objects.create(department=department, unit_number="E2", apparatus_type="engine", station=north)
    WorkOrder.objects.create(department=department, apparatus=engine, title="Pump packing leak")
    WorkOrder.objects.create(department=department, apparatus=e2, title="Light bar out")
    rows = client_for(member).get(f"/api/v1/work-orders/?station={north.id}").json()["results"]
    assert [w["title"] for w in rows] == ["Light bar out"]
