import datetime

import pytest
from django.utils import timezone

from apps.certifications.models import Certification, CertificationType, add_months

TODAY = timezone.localdate()


@pytest.fixture
def emt(department):
    return CertificationType.objects.create(department=department, name="EMT", renewal_months=24, required_for_all=True)


@pytest.fixture
def paramedic(department):
    return CertificationType.objects.create(department=department, name="Paramedic", code="NRP")


def test_add_months_clamps_day():
    assert add_months(datetime.date(2026, 1, 31), 1) == datetime.date(2026, 2, 28)
    assert add_months(datetime.date(2026, 11, 15), 24) == datetime.date(2028, 11, 15)


def test_expiration_filled_from_renewal_period(client_for, officer, member, emt):
    response = client_for(officer).post(
        "/api/v1/certifications/", {"user": member.id, "certification_type": emt.id, "issued_on": "2026-03-01"}
    )
    assert response.status_code == 201, response.json()
    assert response.json()["expires_on"] == "2028-03-01"
    assert response.json()["status"] == "valid"


def test_status(department, member, emt):
    def cert(expires):
        return Certification(department=department, user=member, certification_type=emt, expires_on=expires)

    assert cert(None).status_on(TODAY) == "valid"
    assert cert(TODAY + datetime.timedelta(days=90)).status_on(TODAY) == "valid"
    assert cert(TODAY + datetime.timedelta(days=30)).status_on(TODAY) == "expiring"
    assert cert(TODAY - datetime.timedelta(days=1)).status_on(TODAY) == "expired"


def test_expires_before_issued(client_for, officer, member, emt):
    response = client_for(officer).post(
        "/api/v1/certifications/",
        {"user": member.id, "certification_type": emt.id, "issued_on": "2026-03-01", "expires_on": "2026-01-01"},
    )
    assert response.status_code == 400


def test_members_see_only_their_own_and_cannot_edit(client_for, member, make_user, department, emt):
    other = make_user("ff2")
    Certification.objects.create(department=department, user=member, certification_type=emt)
    Certification.objects.create(department=department, user=other, certification_type=emt)
    client = client_for(member)
    assert [c["user"] for c in client.get("/api/v1/certifications/").json()["results"]] == [member.id]
    assert client.post("/api/v1/certifications/", {"user": member.id, "certification_type": emt.id}).status_code == 403


def test_compliance(client_for, officer, member, make_user, department, emt, paramedic):
    expiring = make_user("ff2", first_name="Ex", last_name="Piring")
    Certification.objects.create(
        department=department, user=member, certification_type=emt, expires_on=TODAY + datetime.timedelta(days=400)
    )
    # An old card replaced by a renewal shouldn't be flagged.
    Certification.objects.create(
        department=department, user=member, certification_type=paramedic, expires_on=TODAY - datetime.timedelta(days=5)
    )
    Certification.objects.create(
        department=department,
        user=member,
        certification_type=paramedic,
        expires_on=TODAY + datetime.timedelta(days=700),
    )
    Certification.objects.create(
        department=department, user=expiring, certification_type=emt, expires_on=TODAY + datetime.timedelta(days=20)
    )
    rows = {r["user"]: r["problems"] for r in client_for(officer).get("/api/v1/certifications/compliance/").json()}
    assert member.id not in rows
    assert [(p["type_name"], p["status"]) for p in rows[expiring.id]] == [("EMT", "expiring")]
    # The officer holds no EMT, which everyone needs.
    assert [(p["type_name"], p["status"]) for p in rows[officer.id]] == [("EMT", "missing")]

    own = client_for(expiring).get("/api/v1/certifications/compliance/").json()
    assert [r["user"] for r in own] == [expiring.id]


def test_dashboard_counts(client_for, officer, member, department, emt):
    Certification.objects.create(
        department=department, user=member, certification_type=emt, expires_on=TODAY + datetime.timedelta(days=10)
    )
    assert client_for(officer).get("/api/v1/dashboard/").json()["certifications_needing_attention"] == 1
    assert client_for(member).get("/api/v1/dashboard/").json()["certifications_needing_attention"] == 1
