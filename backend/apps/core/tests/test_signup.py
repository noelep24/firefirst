from rest_framework.test import APIClient

from apps.apparatus.models import ChecklistTemplate
from apps.certifications.models import CertificationType
from apps.core.models import Department, User
from apps.scheduling.models import Platoon, RotationPattern

FORM = {
    "department_name": "Pine Ridge Fire District",
    "timezone": "America/Denver",
    "first_name": "Dana",
    "last_name": "Reyes",
    "email": "dreyes@pineridgefire.org",
    "username": "dreyes",
    "password": "ridge-line-2026!",
}


def csrf_client():
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/v1/auth/csrf/")
    return client, client.cookies["csrftoken"].value


def test_signup_creates_department_admin_and_signs_in(db):
    client, token = csrf_client()
    response = client.post("/api/v1/signup/", FORM, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 201, response.json()
    department = Department.objects.get(slug="pine-ridge-fire-district")
    assert department.timezone == "America/Denver"
    admin = User.objects.get(username="dreyes")
    assert (admin.department, admin.role) == (department, "admin")
    assert admin.check_password(FORM["password"])
    # Signed in: the session works for the next request.
    assert client.get("/api/v1/me/").json()["department"]["name"] == "Pine Ridge Fire District"
    # Starter kit.
    assert list(Platoon.objects.filter(department=department).values_list("code", flat=True)) == ["A", "B", "C"]
    assert RotationPattern.objects.get(department=department).sequence == ["A", "B", "C"]
    assert ChecklistTemplate.objects.filter(department=department).count() == 1
    assert CertificationType.objects.filter(department=department).count() == 4


def test_signup_without_starter_kit_and_unique_slug(db):
    Department.objects.create(name="Pine Ridge Fire District", slug="pine-ridge-fire-district")
    client, token = csrf_client()
    response = client.post("/api/v1/signup/", {**FORM, "starter_kit": False}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 201
    department = Department.objects.get(slug="pine-ridge-fire-district-2")
    assert not Platoon.objects.filter(department=department).exists()


def test_signup_validation(db, make_user):
    make_user("dreyes")
    client, token = csrf_client()
    response = client.post("/api/v1/signup/", {**FORM, "password": "password"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 400
    errors = response.json()
    assert "username" in errors
    response = client.post(
        "/api/v1/signup/",
        {**FORM, "username": "new-user", "password": "password"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert "password" in response.json()
    assert not Department.objects.filter(name=FORM["department_name"]).exists()


def test_signup_requires_csrf(db):
    client = APIClient(enforce_csrf_checks=True)
    assert client.post("/api/v1/signup/", FORM, format="json").status_code == 403


def test_onboarding_steps(client_for, admin_user, station):
    steps = {s["key"]: s["done"] for s in client_for(admin_user).get("/api/v1/onboarding/").json()}
    assert steps["stations"] is True
    assert steps["apparatus"] is False
    assert steps["people"] is False
