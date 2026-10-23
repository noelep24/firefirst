"""NERIS value sets and the "ready to submit" rules.

Codes come straight from the NERIS framework's CSVs (see neris_values/README.md). Hierarchical codes are
joined with "||", the way NERIS writes them, e.g. ``FIRE||STRUCTURE_FIRE||ROOM_AND_CONTENTS_FIRE``.
"""

import csv
from functools import cache
from pathlib import Path

VALUES_DIR = Path(__file__).parent / "neris_values"

# Value sets used by the incident report, by the name the API exposes.
FLAT = {
    "no_action": "type_noaction",
    "response_mode": "type_response_mode",
    "patient_care": "type_medical_patient_care",
    "patient_status": "type_medical_patient_status",
    "medical_disposition": "type_medical_transport",
    "investigation_need": "type_fire_invest_need",
    "investigation_type": "type_fire_invest",
    "arrival_conditions": "type_fire_condition_arrival",
    "building_damage": "type_fire_bldg_damage",
    "room": "type_room",
    "structure_cause": "type_fire_cause_in",
    "outside_cause": "type_fire_cause_out",
    "water_supply": "type_water_supply",
    "suppression_appliance": "type_suppress_appliance",
    "presence": "type_rr_presence",
}
HIERARCHICAL = {"incident_type": "type_incident", "action": "type_action_tactic"}


def _rows(name):
    with open(VALUES_DIR / f"{name}.csv", newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if (r.get("active") or "TRUE").strip().upper() == "TRUE"]


@cache
def value_sets():
    """{name: [{"value": code, "label": text}]} for every value set the report uses."""
    sets = {}
    for name, file in FLAT.items():
        sets[name] = [{"value": r["value"].strip(), "label": r["description"].strip()} for r in _rows(file)]
    for name, file in HIERARCHICAL.items():
        items = []
        for r in _rows(file):
            parts = [r[f"value_{i}"].strip() for i in (1, 2, 3) if (r.get(f"value_{i}") or "").strip()]
            labels = [r[f"description_{i}"].strip() for i in (1, 2, 3) if (r.get(f"value_{i}") or "").strip()]
            items.append({"value": "||".join(parts), "label": " › ".join(labels)})
        sets[name] = items
    return sets


@cache
def codes(name):
    return frozenset(item["value"] for item in value_sets()[name])


def label(name, code):
    return next((item["label"] for item in value_sets()[name] if item["value"] == code), code)


def is_fire(types):
    return any(t.startswith("FIRE||") for t in types)


def is_structure_fire(types):
    return any(t.startswith("FIRE||STRUCTURE_FIRE") for t in types)


def is_outside_fire(types):
    return any(t.startswith("FIRE||OUTSIDE_FIRE") for t in types)


def is_medical(types):
    return any(t.startswith("MEDICAL||") for t in types)


# ---- What each part of a report holds, and which value set each coded answer uses ----

FIRE_FIELDS = {
    "suppression_appliances": ("suppression_appliance", True),
    "water_supply": ("water_supply", False),
    "investigation_need": ("investigation_need", False),
    "investigation_types": ("investigation_type", True),
    "arrival_conditions": ("arrival_conditions", False),
    "building_damage": ("building_damage", False),
    "room_of_origin": ("room", False),
    "structure_cause": ("structure_cause", False),
    "outside_cause": ("outside_cause", False),
}
FIRE_NUMBERS = {"floor_of_origin", "acres_burned"}
ALARM_FIELDS = ("smoke_alarm", "fire_alarm", "sprinklers")
PATIENT_FIELDS = {"care": "patient_care", "status": "patient_status", "disposition": "medical_disposition"}


def missing(incident, units):
    """What NERIS still needs before this report can be submitted, in plain words. Empty means ready."""
    types = incident.incident_types or []
    fire, alarms, patients = incident.fire or {}, incident.alarms or {}, incident.patients or []
    todo = []
    if not incident.department.neris_id:
        todo.append("Department NERIS ID (an admin adds it in Department settings)")
    if not types:
        todo.append("Incident type")
    if not (incident.address and incident.city and incident.state):
        todo.append("Address (street, city and state)")
    if incident.people_present is None:
        todo.append("Were people present?")
    if not incident.actions_taken and not incident.no_action_reason:
        todo.append("Actions taken (or why none were taken)")
    if incident.rescues_or_casualties is None:
        todo.append("Any rescues or casualties?")
    if not units:
        todo.append("At least one responding unit")
    for unit in units:
        if not unit.dispatched_at:
            todo.append(f"{unit.unit}: dispatch time")
        if not unit.response_mode:
            todo.append(f"{unit.unit}: response mode (emergent or not)")

    if is_fire(types):
        if not fire.get("suppression_appliances"):
            todo.append("Fire: suppression used (or None)")
        if (
            fire.get("suppression_appliances")
            and fire["suppression_appliances"] != ["NONE"]
            and not fire.get("water_supply")
        ):
            todo.append("Fire: water supply")
        if not fire.get("investigation_need"):
            todo.append("Fire: investigation needed?")
        if fire.get("investigation_need") == "YES" and not fire.get("investigation_types"):
            todo.append("Fire: investigation type")
    if is_structure_fire(types):
        for key, text in (
            ("arrival_conditions", "conditions on arrival"),
            ("building_damage", "building damage"),
            ("floor_of_origin", "floor of origin"),
            ("room_of_origin", "room of origin"),
            ("structure_cause", "cause"),
        ):
            if fire.get(key) in (None, ""):
                todo.append(f"Structure fire: {text}")
        for key, text in (
            ("smoke_alarm", "smoke alarms"),
            ("fire_alarm", "fire alarm system"),
            ("sprinklers", "sprinklers"),
        ):
            if not alarms.get(key):
                todo.append(f"Structure fire: {text} present?")
    if is_outside_fire(types) and not fire.get("outside_cause"):
        todo.append("Outside fire: cause")
    if is_medical(types):
        if not patients:
            todo.append("Medical: at least one patient")
        for i, patient in enumerate(patients, start=1):
            if not patient.get("care"):
                todo.append(f"Patient {i}: evaluation and care")
    return todo


def payload(incident, units, fd_neris_id=None):
    """The report shaped like a NERIS incident submission (field names from the NERIS framework).

    Direct submission needs NERIS vendor approval; until then this is an export for review or upload.
    """
    types = incident.incident_types or []
    fire, alarms = incident.fire or {}, incident.alarms or {}

    def iso(dt):
        return dt.isoformat() if dt else None

    location = {
        "an_complete": incident.address,
        "nl_additional_info": incident.address_detail or None,
        "csop_incorporated_muni": incident.city,
        "csop_state": incident.state,
        "csop_postal_code": incident.postal_code or None,
        "csop_country": "US",
    }
    body = {
        "fd_neris_id": fd_neris_id,
        "incident_internal_id": incident.number,
        "dispatch": {
            "dispatch_internal_id": incident.number,
            "dispatch_location": location,
            "dispatch_time_call_create": iso(incident.alarm_at),
        },
        "incident_final_type": [t.split("||") for t in types],
        "incident_final_type_primary": [i == 0 for i in range(len(types))],
        "incident_location": location,
        "incident_people_present": incident.people_present,
        "incident_displaced_number": incident.displaced,
        "incident_actions_taken": [a.split("||") for a in incident.actions_taken] or None,
        "incident_noaction": incident.no_action_reason or None,
        "incident_narrative_outcome": incident.narrative or None,
        "unit_response": [
            {
                "unit_id_reported": unit.unit,
                "unit_staffing_reported": unit.staffing,
                "unit_response_mode": unit.response_mode or None,
                "time_dispatch": iso(unit.dispatched_at),
                "time_enroute_to_scene": iso(unit.enroute_at),
                "time_on_scene": iso(unit.on_scene_at),
                "time_canceled_enroute": iso(unit.cancelled_at),
                "time_unit_clear": iso(unit.cleared_at),
            }
            for unit in units
        ],
    }
    if is_fire(types):
        body["fire"] = {
            "fire_suppression_appliance": fire.get("suppression_appliances"),
            "fire_water_supply": fire.get("water_supply"),
            "fire_investigation_need": fire.get("investigation_need"),
            "fire_investigation_type": fire.get("investigation_types"),
        }
        if is_structure_fire(types):
            body["fire"].update(
                structure_arrival_conditions=fire.get("arrival_conditions"),
                structure_damage=fire.get("building_damage"),
                structure_floor_of_origin=fire.get("floor_of_origin"),
                structure_room_of_origin=fire.get("room_of_origin"),
                structure_fire_cause=fire.get("structure_cause"),
            )
            body["risk_reduction"] = {
                "smoke_alarm_presence": alarms.get("smoke_alarm"),
                "fire_alarm_presence": alarms.get("fire_alarm"),
                "fire_suppression_presence": alarms.get("sprinklers"),
            }
        if is_outside_fire(types):
            body["fire"].update(
                outside_fire_cause=fire.get("outside_cause"), outside_fire_acres_burned=fire.get("acres_burned")
            )
    if is_medical(types):
        body["medical"] = [
            {
                "patient_care_report": p.get("eso_report") or None,
                "patient_evaluation_care": p.get("care"),
                "patient_improved_status": p.get("status") or None,
                "medical_disposition": p.get("disposition") or None,
            }
            for p in incident.patients or []
        ]
    return body
