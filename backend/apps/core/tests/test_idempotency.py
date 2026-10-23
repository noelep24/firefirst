import uuid

import pytest
from rest_framework.test import APIClient

from apps.apparatus.models import Apparatus, ChecklistItem, ChecklistTemplate, Inspection, WorkOrder
from apps.core.models import IdempotencyKey
from apps.inventory.models import Item, StockLevel, StorageLocation


@pytest.fixture
def jwt(member):
    client = APIClient()
    token = client.post("/api/v1/auth/token/", {"username": "ff1", "password": "test-pass-123"}).json()["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


@pytest.fixture
def rig_check(department):
    rig = Apparatus.objects.create(department=department, unit_number="E1", apparatus_type="engine")
    template = ChecklistTemplate.objects.create(department=department, name="Daily")
    item = ChecklistItem.objects.create(template=template, prompt="Lights")
    return {
        "apparatus": rig.id,
        "template": template.id,
        "create_work_orders": True,
        "results": [{"checklist_item": item.id, "status": "deficient", "note": "Out"}],
    }


def test_retried_rig_check_is_saved_once(jwt, rig_check):
    key = str(uuid.uuid4())
    first = jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key)
    retry = jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    assert retry["Idempotent-Replayed"] == "true"
    assert Inspection.objects.count() == 1
    assert WorkOrder.objects.count() == 1


def test_different_keys_are_different_requests(jwt, rig_check):
    jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
    assert Inspection.objects.count() == 2


def test_retried_stock_adjustment_applies_once(jwt, department, station):
    location = StorageLocation.objects.create(department=department, name="Closet", station=station)
    stock = StockLevel.objects.create(
        department=department,
        item=Item.objects.create(department=department, name="Gauze"),
        location=location,
        quantity=10,
    )
    key = str(uuid.uuid4())
    for _ in range(3):
        response = jwt.post(
            f"/api/v1/inventory/stock/{stock.id}/adjust/", {"change": -2, "reason": "used"}, HTTP_IDEMPOTENCY_KEY=key
        )
        assert response.status_code == 201
    stock.refresh_from_db()
    assert stock.quantity == 8


def test_failed_requests_are_not_remembered(jwt, rig_check):
    key = str(uuid.uuid4())
    bad = {**rig_check, "results": [{**rig_check["results"][0], "note": ""}]}  # deficient needs a note
    assert jwt.post("/api/v1/inspections/", bad, format="json", HTTP_IDEMPOTENCY_KEY=key).status_code == 400
    # Fixed and retried with the same key: it runs.
    assert jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key).status_code == 201
    assert Inspection.objects.count() == 1


def test_key_reused_for_another_endpoint(jwt, rig_check, department):
    key = str(uuid.uuid4())
    jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key)
    response = jwt.post(
        "/api/v1/work-orders/",
        {"apparatus": rig_check["apparatus"], "title": "x"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert response.status_code == 422


def test_in_flight_duplicate_gets_409(jwt, member, rig_check):
    key = str(uuid.uuid4())
    IdempotencyKey.objects.create(user=member, key=key, path="/api/v1/inspections/")
    response = jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert response.status_code == 409
    assert Inspection.objects.count() == 0


def test_keys_are_per_user(jwt, rig_check, make_user):
    key = str(uuid.uuid4())
    jwt.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key)
    make_user("ff2")
    other = APIClient()
    token = other.post("/api/v1/auth/token/", {"username": "ff2", "password": "test-pass-123"}).json()["access"]
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    response = other.post("/api/v1/inspections/", rig_check, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert response.status_code == 201
    assert "Idempotent-Replayed" not in response
    assert Inspection.objects.count() == 2


def test_requests_without_a_key_are_unaffected(jwt, rig_check):
    jwt.post("/api/v1/inspections/", rig_check, format="json")
    jwt.post("/api/v1/inspections/", rig_check, format="json")
    assert Inspection.objects.count() == 2
    assert not IdempotencyKey.objects.exists()
