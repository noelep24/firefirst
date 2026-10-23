import pytest
from rest_framework.test import APIClient

from apps.core.models import Department, Station, User


@pytest.fixture
def department(db):
    return Department.objects.create(name="Riverside Fire", slug="riverside")


@pytest.fixture
def other_department(db):
    return Department.objects.create(name="Lakeview Fire", slug="lakeview")


@pytest.fixture
def station(department):
    return Station.objects.create(department=department, number="1", name="Headquarters")


@pytest.fixture
def make_user(department):
    def make(username, role=User.Role.MEMBER, dept=None, **extra):
        return User.objects.create_user(
            username=username,
            password="test-pass-123",
            department=dept or department,
            role=role,
            **extra,
        )

    return make


@pytest.fixture
def admin_user(make_user):
    return make_user("chief", User.Role.ADMIN, first_name="Pat", last_name="Chief")


@pytest.fixture
def officer(make_user):
    return make_user("captain", User.Role.OFFICER, first_name="Sam", last_name="Captain")


@pytest.fixture
def member(make_user):
    return make_user("ff1", first_name="Alex", last_name="Rivera")


@pytest.fixture
def client_for():
    def make(user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    return make
