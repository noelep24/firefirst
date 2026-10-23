import datetime

import pytest
from django.utils import timezone

from apps.apparatus.models import Apparatus
from apps.incidents import neris
from apps.incidents.models import Incident
from apps.scheduling.models import Assignment, Platoon, RotationPattern

URL = "/api/v1/incidents/"
STRUCTURE = "FIRE||STRUCTURE_FIRE||ROOM_AND_CONTENTS_FIRE"


@pytest.fixture
def engine(department, station):
    return Apparatus.objects.create(department=department, unit_number="E1", apparatus_type="engine", station=station)


@pytest.fixture
def crew_on_e1(department, station, engine, make_user):
    """Two members riding E1 on a shift that works today."""
    platoon = Platoon.objects.create(department=department, code="A")
    RotationPattern.objects.create(department=department, name="24", anchor_date=timezone.localdate(), sequence=["A"])
    people = [make_user("cap", last_name="Stone"), make_user("eng", last_name="Reyes")]
    for user, position in zip(people, ["captain", "engineer"], strict=True):
        Assignment.objects.create(
            department=department, user=user, platoon=platoon, station=station, position=position, apparatus=engine
        )
    return people


def new_incident(client, **fields):
    response = client.post(URL, {"alarm_at": timezone.now().isoformat(), **fields}, format="json")
    assert response.status_code == 201, response.content
    return response.json()


def test_value_sets_come_from_neris(client_for, member):
    sets = client_for(member).get("/api/v1/neris/value-sets/").json()
    codes = {t["value"] for t in sets["incident_type"]}
    assert {STRUCTURE, "MEDICAL||ILLNESS||ABDOMINAL_PAIN"} <= codes
    assert {"EMERGENT", "NON_EMERGENT"} == {m["value"] for m in sets["response_mode"]}
    assert all(t["label"] for t in sets["incident_type"])


def test_member_writes_a_report_numbered_per_year(client_for, member):
    client = client_for(member)
    first = new_incident(client)
    second = new_incident(client)
    year = timezone.localdate().year
    assert (first["number"], second["number"]) == (f"{year}-00001", f"{year}-00002")
    assert first["status"] == "draft"
    assert "Incident type" in first["missing"]
    assert any("NERIS ID" in item for item in first["missing"])


def test_unit_gets_the_crew_riding_that_rig(client_for, member, engine, crew_on_e1):
    client = client_for(member)
    incident = new_incident(client)
    response = client.post(
        "/api/v1/incident-units/", {"incident": incident["id"], "apparatus": engine.id}, format="json"
    )
    assert response.status_code == 201, response.content
    unit = response.json()
    assert unit["unit"] == "E1"
    assert sorted(unit["crew"]) == sorted(u.id for u in crew_on_e1)
    assert unit["staffing"] == 2


def test_codes_are_checked_against_neris(client_for, member):
    client = client_for(member)
    bad = [
        {"incident_types": ["FIRE||NOT_A_THING"]},
        {"incident_types": [STRUCTURE, STRUCTURE]},
        {"actions_taken": ["NOPE"]},
        {"fire": {"water_supply": "GARDEN_HOSE"}},
        {"fire": {"mystery": "X"}},
        {"alarms": {"smoke_alarm": "MAYBE"}},
        {"patients": [{"eso_report": "123", "care": "FIXED_IT"}]},
        {"state": "Texas"},
        {"actions_taken": ["EMERGENCY_MEDICAL_CARE||PATIENT_ASSESSMENT"], "no_action_reason": "CANCELLED"},
    ]
    for fields in bad:
        response = client.post(URL, {"alarm_at": timezone.now().isoformat(), **fields}, format="json")
        assert response.status_code == 400, fields


def test_structure_fire_checklist_complete_and_export(client_for, member, officer, department, engine, crew_on_e1):
    department.neris_id = "FD12345678"
    department.save()
    client = client_for(member)
    incident = new_incident(
        client,
        address="120 N Oak Ave",
        city="Riverside",
        state="tx",
        incident_types=[STRUCTURE],
        people_present=True,
        rescues_or_casualties=False,
        actions_taken=["SUPPRESSION||STRUCTURAL_FIRE_SUPPRESSION||INTERIOR"],
    )
    url = f"{URL}{incident['id']}/"
    missing = client.get(url).json()["missing"]
    assert "Structure fire: room of origin" in missing and "At least one responding unit" in missing
    assert client.post(url + "complete/").status_code == 400

    client.post(
        "/api/v1/incident-units/",
        {
            "incident": incident["id"],
            "apparatus": engine.id,
            "response_mode": "EMERGENT",
            "dispatched_at": timezone.now().isoformat(),
        },
        format="json",
    )
    response = client.patch(
        url,
        {
            "fire": {
                "suppression_appliances": ["SMALL_DIAMETER_FIRE_HOSE"],
                "water_supply": "TANK_WATER",
                "investigation_need": "NO_CAUSE_OBVIOUS",
                "arrival_conditions": sorted(neris.codes("arrival_conditions"))[0],
                "building_damage": sorted(neris.codes("building_damage"))[0],
                "floor_of_origin": 1,
                "room_of_origin": sorted(neris.codes("room"))[0],
                "structure_cause": sorted(neris.codes("structure_cause"))[0],
            },
            "alarms": {"smoke_alarm": "PRESENT", "fire_alarm": "NOT_PRESENT", "sprinklers": "NOT_PRESENT"},
        },
        format="json",
    )
    assert response.json()["missing"] == [], response.json()["missing"]
    done = client.post(url + "complete/")
    assert done.status_code == 200 and done.json()["status"] == "complete"

    # Completed reports are locked for members; officers can reopen.
    assert client.patch(url, {"narrative": "late edit"}, format="json").status_code == 403
    assert client.post(url + "reopen/").status_code == 403
    assert client_for(officer).post(url + "reopen/").json()["status"] == "draft"

    body = client.get(url + "neris/").json()
    assert body["fd_neris_id"] == "FD12345678"
    assert body["incident_final_type"] == [["FIRE", "STRUCTURE_FIRE", "ROOM_AND_CONTENTS_FIRE"]]
    assert body["incident_location"]["csop_state"] == "TX"
    assert body["fire"]["structure_floor_of_origin"] == 1
    assert body["risk_reduction"]["smoke_alarm_presence"] == "PRESENT"
    assert body["unit_response"][0]["unit_id_reported"] == "E1"
    assert body["unit_response"][0]["unit_staffing_reported"] == 2


def test_medical_call_needs_a_patient_and_keeps_only_the_eso_number(client_for, member):
    medical = sorted(c for c in neris.codes("incident_type") if c.startswith("MEDICAL||"))[0]
    client = client_for(member)
    incident = new_incident(client, incident_types=[medical])
    assert "Medical: at least one patient" in incident["missing"]
    url = f"{URL}{incident['id']}/"
    response = client.patch(
        url,
        {"patients": [{"eso_report": " 2026-0042 ", "care": "PATIENT_EVALUATED_CARE_PROVIDED", "name": "Jane Doe"}]},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["patients"] == [{"eso_report": "2026-0042", "care": "PATIENT_EVALUATED_CARE_PROVIDED"}]
    assert client.get(url + "neris/").json()["medical"][0]["patient_care_report"] == "2026-0042"


def test_incidents_are_department_scoped(client_for, member, other_department, make_user):
    outsider = make_user("outsider", dept=other_department)
    incident = new_incident(client_for(member))
    assert client_for(outsider).get(f"{URL}{incident['id']}/").status_code == 404
    assert client_for(member).delete(f"{URL}{incident['id']}/").status_code == 403
    assert Incident.objects.count() == 1


def test_department_neris_id_format(client_for, admin_user):
    client = client_for(admin_user)
    url = "/api/v1/department/"
    assert client.patch(url, {"neris_id": "FD1"}, format="json").status_code == 400
    assert client.patch(url, {"neris_id": "fd12345678"}, format="json").json()["neris_id"] == "FD12345678"


def test_report_dates(client_for, member):
    incident = new_incident(client_for(member), alarm_at=(timezone.now() - datetime.timedelta(days=1)).isoformat())
    assert incident["alarm_at"]
