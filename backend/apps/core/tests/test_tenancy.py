import pytest

from apps.apparatus.models import Apparatus
from apps.core.models import Station, User


@pytest.fixture
def foreign_station(other_department):
    return Station.objects.create(department=other_department, number="9")


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/v1/stations/").status_code in (401, 403)


def test_user_without_department_is_rejected(db, client_for):
    staff = User.objects.create_user("platform", password="x" * 12)
    assert client_for(staff).get("/api/v1/stations/").status_code == 403


def test_list_only_returns_own_department(client_for, member, station, foreign_station):
    response = client_for(member).get("/api/v1/stations/")
    assert [s["id"] for s in response.json()["results"]] == [station.id]


def test_cannot_read_another_departments_record(client_for, member, foreign_station):
    assert client_for(member).get(f"/api/v1/stations/{foreign_station.id}/").status_code == 404


def test_created_records_get_requesters_department(client_for, admin_user, department):
    response = client_for(admin_user).post("/api/v1/stations/", {"number": "2"})
    assert response.status_code == 201
    assert Station.objects.get(id=response.json()["id"]).department == department


def test_cannot_link_to_another_departments_record(client_for, officer, foreign_station):
    response = client_for(officer).post(
        "/api/v1/apparatus/",
        {"unit_number": "E1", "apparatus_type": "engine", "station": foreign_station.id},
    )
    assert response.status_code == 400
    assert "station" in response.json()
    assert not Apparatus.objects.exists()


def test_members_cannot_change_department_setup(client_for, member):
    assert client_for(member).post("/api/v1/stations/", {"number": "3"}).status_code == 403


def test_users_list_is_scoped(client_for, member, make_user, other_department):
    make_user("outsider", dept=other_department)
    usernames = {u["username"] for u in client_for(member).get("/api/v1/users/").json()["results"]}
    assert "outsider" not in usernames
    assert "ff1" in usernames


def test_me_cannot_escalate_role(client_for, member):
    response = client_for(member).patch("/api/v1/me/", {"role": "admin", "phone": "555-0100"}, format="json")
    assert response.status_code == 200
    member.refresh_from_db()
    assert member.role == User.Role.MEMBER
    assert member.phone == "555-0100"


def test_admin_creates_user_with_hashed_password(client_for, admin_user):
    response = client_for(admin_user).post(
        "/api/v1/users/",
        {"username": "newbie", "password": "a-strong-pass", "role": "member"},
    )
    assert response.status_code == 201
    assert "password" not in response.json()
    assert User.objects.get(username="newbie").check_password("a-strong-pass")


def test_jwt_login(client, member):
    response = client.post("/api/v1/auth/token/", {"username": "ff1", "password": "test-pass-123"})
    assert response.status_code == 200
    token = response.json()["access"]
    me = client.get("/api/v1/me/", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert me.json()["department"]["slug"] == "riverside"


def test_dashboard(client_for, officer, station):
    Apparatus.objects.create(
        department=officer.department, unit_number="E1", apparatus_type="engine", status="out_of_service"
    )
    data = client_for(officer).get("/api/v1/dashboard/").json()
    assert data["apparatus_out_of_service"][0]["unit_number"] == "E1"
    assert data["pending_leave_requests"] == 0


def test_deleting_a_user_deactivates_them(client_for, admin_user, member):
    assert client_for(admin_user).delete(f"/api/v1/users/{member.id}/").status_code == 204
    member.refresh_from_db()
    assert member.is_active is False


def test_deleting_a_department_removes_all_its_data(db):
    """Offboarding a customer: everything goes, even rows other rows depend on (RESTRICT, not PROTECT)."""
    from django.core.management import call_command

    from apps.apparatus.models import ChecklistTemplate, Inspection
    from apps.core.models import Department
    from apps.scheduling.models import Platoon

    call_command("seed_demo", slug="gone", stdout=open("/dev/null", "w"))
    dept = Department.objects.get(slug="gone")
    template = ChecklistTemplate.objects.get(department=dept)
    Inspection.objects.create(
        department=dept,
        apparatus=Apparatus.objects.filter(department=dept, apparatus_type="engine").first(),
        template=template,
        performed_by=User.objects.filter(department=dept).first(),
    )
    dept.delete()
    assert not User.objects.filter(username__startswith="gone-").exists()
    assert not Platoon.objects.exists()
    assert not Inspection.objects.exists()


def test_platoon_with_members_cannot_be_deleted_on_its_own(department, make_user):
    from django.db.models import RestrictedError

    from apps.scheduling.models import Assignment, Platoon

    platoon = Platoon.objects.create(department=department, code="A")
    Assignment.objects.create(department=department, user=make_user("ff9"), platoon=platoon)
    with pytest.raises(RestrictedError):
        platoon.delete()
