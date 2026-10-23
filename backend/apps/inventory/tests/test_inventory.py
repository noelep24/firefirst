import datetime

import pytest
from django.utils import timezone

from apps.inventory.models import Item, StockLevel, StockTransaction, StorageLocation


@pytest.fixture
def gauze(department):
    return Item.objects.create(department=department, name="4x4 gauze", category="ems", unit="pack")


@pytest.fixture
def supply_room(department, station):
    return StorageLocation.objects.create(department=department, name="EMS supply room", station=station)


@pytest.fixture
def stock(department, gauze, supply_room):
    return StockLevel.objects.create(department=department, item=gauze, location=supply_room, quantity=10, par_level=8)


def test_initial_quantity_is_logged(client_for, officer, gauze, supply_room):
    response = client_for(officer).post(
        "/api/v1/inventory/stock/",
        {"item": gauze.id, "location": supply_room.id, "quantity": 25, "par_level": 10},
        format="json",
    )
    assert response.status_code == 201, response.json()
    stock = StockLevel.objects.get()
    assert stock.quantity == 25
    assert stock.transactions.get().change == 25


def test_quantity_cannot_be_edited_directly(client_for, officer, stock):
    client_for(officer).patch(f"/api/v1/inventory/stock/{stock.id}/", {"quantity": 999, "par_level": 12}, format="json")
    stock.refresh_from_db()
    assert stock.quantity == 10
    assert stock.par_level == 12


def test_member_records_usage(client_for, member, stock):
    response = client_for(member).post(
        f"/api/v1/inventory/stock/{stock.id}/adjust/", {"change": -3, "reason": "used", "note": "Run 26-1042"}
    )
    assert response.status_code == 201
    assert response.json()["stock"]["quantity"] == 7
    assert response.json()["stock"]["below_par"] is True
    txn = StockTransaction.objects.get()
    assert (txn.change, txn.performed_by) == (-3, member)


def test_cannot_go_negative(client_for, member, stock):
    response = client_for(member).post(f"/api/v1/inventory/stock/{stock.id}/adjust/", {"change": -11, "reason": "used"})
    assert response.status_code == 400
    stock.refresh_from_db()
    assert stock.quantity == 10
    assert not StockTransaction.objects.exists()


def test_below_par_filter(client_for, member, stock, department, supply_room):
    full = Item.objects.create(department=department, name="Gloves L")
    StockLevel.objects.create(department=department, item=full, location=supply_room, quantity=50, par_level=20)
    stock.adjust(-5, "used", member)
    results = client_for(member).get("/api/v1/inventory/stock/?below_par=true").json()["results"]
    assert [r["item_name"] for r in results] == ["4x4 gauze"]


def test_expiring(client_for, member, stock, department, supply_room):
    stock.expires_on = timezone.localdate() + datetime.timedelta(days=10)
    stock.save()
    later = Item.objects.create(department=department, name="Saline")
    StockLevel.objects.create(
        department=department,
        item=later,
        location=supply_room,
        quantity=4,
        expires_on=timezone.localdate() + datetime.timedelta(days=90),
    )
    client = client_for(member)
    assert [r["item_name"] for r in client.get("/api/v1/inventory/stock/expiring/").json()] == ["4x4 gauze"]
    assert len(client.get("/api/v1/inventory/stock/expiring/?days=120").json()) == 2


def test_location_needs_exactly_one_owner(client_for, officer, station):
    client = client_for(officer)
    assert client.post("/api/v1/inventory/locations/", {"name": "Floating"}).status_code == 400
    assert client.post("/api/v1/inventory/locations/", {"name": "Closet", "station": station.id}).status_code == 201


def test_members_cannot_edit_catalog(client_for, member):
    assert client_for(member).post("/api/v1/inventory/items/", {"name": "x"}).status_code == 403


def test_transactions_are_scoped(client_for, member, make_user, other_department, stock):
    stock.adjust(-1, "used", member)
    outsider = make_user("outsider", dept=other_department)
    assert client_for(outsider).get("/api/v1/inventory/transactions/").json()["results"] == []
