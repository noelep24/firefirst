import pytest

from apps.apparatus.models import Apparatus
from apps.audit.models import AuditEntry
from apps.core.models import Department


@pytest.fixture
def engine(department):
    return Apparatus.objects.create(department=department, unit_number="E1", apparatus_type="engine")


def entries(model):
    return list(AuditEntry.objects.filter(model=model).order_by("id"))


def test_api_create_records_actor_and_snapshot(client_for, officer):
    response = client_for(officer).post("/api/v1/apparatus/", {"unit_number": "L1", "apparatus_type": "ladder"})
    assert response.status_code == 201
    [entry] = entries("apparatus.Apparatus")
    assert entry.action == "create"
    assert entry.actor == officer
    assert entry.department == officer.department
    assert entry.changes["unit_number"] == "L1"


def test_jwt_requests_record_the_actor(client, officer):
    token = client.post("/api/v1/auth/token/", {"username": "captain", "password": "test-pass-123"}).json()["access"]
    client.post(
        "/api/v1/stations/", {"number": "7"}, HTTP_AUTHORIZATION=f"Bearer {token}"
    )  # officer can't create stations; nothing should be logged
    client.post(
        "/api/v1/apparatus/",
        {"unit_number": "R1", "apparatus_type": "rescue"},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert [e.actor for e in entries("apparatus.Apparatus")] == [officer]
    assert not entries("core.Station")


def test_update_records_only_changed_fields(client_for, officer, engine):
    client_for(officer).patch(f"/api/v1/apparatus/{engine.id}/", {"mileage": 1200, "make": "Pierce"}, format="json")
    update = entries("apparatus.Apparatus")[-1]
    assert update.action == "update"
    assert update.changes == {"mileage": [0, 1200], "make": ["", "Pierce"]}


def test_no_op_save_is_not_logged(department, engine):
    before = AuditEntry.objects.count()
    engine.save()
    assert AuditEntry.objects.count() == before


def test_side_effects_are_attributed_to_the_requesting_user(client_for, member, engine):
    client_for(member).post(
        "/api/v1/work-orders/",
        {"apparatus": engine.id, "title": "Pump", "takes_out_of_service": True},
        format="json",
    )
    status_change = entries("apparatus.Apparatus")[-1]
    assert status_change.changes == {"status": ["in_service", "out_of_service"]}
    assert status_change.actor == member


def test_delete_is_logged(client_for, admin_user, station):
    client_for(admin_user).delete(f"/api/v1/stations/{station.id}/")
    entry = entries("core.Station")[-1]
    assert entry.action == "delete"
    assert entry.changes["number"] == "1"


def test_passwords_are_never_logged(client_for, admin_user):
    client_for(admin_user).post("/api/v1/users/", {"username": "new", "password": "a-strong-pass"})
    [entry] = AuditEntry.objects.filter(model="core.User", object_repr="new")
    assert entry.actor == admin_user
    assert "password" not in entry.changes


def test_only_admins_can_read_the_log(client_for, officer, admin_user, engine):
    assert client_for(officer).get("/api/v1/audit-log/").status_code == 403
    assert client_for(admin_user).get("/api/v1/audit-log/").status_code == 200


def test_log_is_scoped_to_department(client_for, admin_user, make_user, other_department):
    Apparatus.objects.create(department=other_department, unit_number="X9", apparatus_type="engine")
    outsider_admin = make_user("other-admin", "admin", dept=other_department)
    mine = {e["object_repr"] for e in client_for(admin_user).get("/api/v1/audit-log/").json()["results"]}
    theirs = {e["object_repr"] for e in client_for(outsider_admin).get("/api/v1/audit-log/").json()["results"]}
    assert "X9" not in mine
    assert "X9" in theirs
    assert str(admin_user) not in theirs


def test_filter_by_object(client_for, admin_user, engine, department):
    Apparatus.objects.create(department=department, unit_number="E2", apparatus_type="engine")
    results = (
        client_for(admin_user)
        .get(f"/api/v1/audit-log/?model=apparatus.Apparatus&object_id={engine.id}")
        .json()["results"]
    )
    assert [e["object_repr"] for e in results] == ["E1"]


def test_deleting_a_department_does_not_break_on_logging(department, engine):
    department.delete()
    assert not Department.objects.filter(pk=department.pk).exists()
    assert not AuditEntry.objects.filter(department_id=department.pk).exists()
