from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.tenancy import TenantSerializer

from . import neris
from .models import Incident, IncidentUnit


def _check_code(set_name, value, field):
    if value not in neris.codes(set_name):
        raise serializers.ValidationError({field: f"“{value}” isn't a NERIS {set_name.replace('_', ' ')} code."})


class IncidentUnitSerializer(TenantSerializer):
    crew_names = serializers.SerializerMethodField()

    class Meta:
        model = IncidentUnit
        fields = [
            "id",
            "incident",
            "apparatus",
            "unit",
            "response_mode",
            "crew",
            "crew_names",
            "staffing",
            "dispatched_at",
            "enroute_at",
            "on_scene_at",
            "cancelled_at",
            "cleared_at",
        ]
        extra_kwargs = {"unit": {"required": False}, "crew": {"required": False}}

    def get_crew_names(self, unit) -> list[str]:
        return [str(user) for user in unit.crew.all()]

    def validate(self, attrs):
        if attrs.get("response_mode"):
            _check_code("response_mode", attrs["response_mode"], "response_mode")
        apparatus = attrs.get("apparatus")
        if not attrs.get("unit") and not getattr(self.instance, "unit", None):
            if apparatus is None:
                raise serializers.ValidationError({"unit": "Pick a rig or type the unit's designation."})
            attrs["unit"] = apparatus.unit_number
        return attrs


class IncidentSerializer(TenantSerializer):
    units = IncidentUnitSerializer(many=True, read_only=True)
    missing = serializers.SerializerMethodField(help_text="What NERIS still needs; empty when the report is ready")
    type_labels = serializers.SerializerMethodField()
    station_name = serializers.StringRelatedField(source="station", read_only=True)
    created_by_name = serializers.StringRelatedField(source="created_by", read_only=True)

    class Meta:
        model = Incident
        fields = [
            "id",
            "number",
            "status",
            "alarm_at",
            "station",
            "station_name",
            "address",
            "address_detail",
            "city",
            "state",
            "postal_code",
            "incident_types",
            "type_labels",
            "actions_taken",
            "no_action_reason",
            "people_present",
            "displaced",
            "rescues_or_casualties",
            "fire",
            "alarms",
            "patients",
            "narrative",
            "units",
            "missing",
            "created_by_name",
            "completed_at",
        ]
        read_only_fields = ["status", "completed_at"]
        extra_kwargs = {"number": {"required": False}}

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_missing(self, incident):
        return neris.missing(incident, list(incident.units.all()))

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_type_labels(self, incident):
        return [neris.label("incident_type", t) for t in incident.incident_types or []]

    def validate_state(self, value):
        value = value.strip().upper()
        if value and (len(value) != 2 or not value.isalpha()):
            raise serializers.ValidationError("Use the two-letter state code, e.g. TX.")
        return value

    def validate_incident_types(self, value):
        if not isinstance(value, list) or len(value) > 3 or len(set(value)) != len(value):
            raise serializers.ValidationError("Pick up to three different incident types.")
        for code in value:
            _check_code("incident_type", code, "incident_types")
        return value

    def validate_actions_taken(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of action codes.")
        for code in value:
            _check_code("action", code, "actions_taken")
        return value

    def validate_no_action_reason(self, value):
        if value:
            _check_code("no_action", value, "no_action_reason")
        return value

    def validate_fire(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Expected an object.")
        for key, answer in value.items():
            if answer in (None, "", []):
                continue
            if key in neris.FIRE_NUMBERS:
                if not isinstance(answer, (int, float)) or answer < 0:
                    raise serializers.ValidationError({key: "Expected a number."})
            elif key in neris.FIRE_FIELDS:
                set_name, many = neris.FIRE_FIELDS[key]
                for code in answer if many else [answer]:
                    _check_code(set_name, code, f"fire.{key}")
            else:
                raise serializers.ValidationError(f"Unknown fire question “{key}”.")
        return {k: v for k, v in value.items() if v not in (None, "", [])}

    def validate_alarms(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Expected an object.")
        for key, answer in value.items():
            if key not in neris.ALARM_FIELDS:
                raise serializers.ValidationError(f"Unknown alarm question “{key}”.")
            if answer:
                _check_code("presence", answer, f"alarms.{key}")
        return {k: v for k, v in value.items() if v}

    def validate_patients(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of patients.")
        cleaned = []
        for patient in value:
            if not isinstance(patient, dict):
                raise serializers.ValidationError("Each patient is an object.")
            row = {"eso_report": str(patient.get("eso_report") or "").strip()[:255]}
            for key, set_name in neris.PATIENT_FIELDS.items():
                if patient.get(key):
                    _check_code(set_name, patient[key], f"patients.{key}")
                    row[key] = patient[key]
            cleaned.append(row)
        return cleaned

    def validate(self, attrs):
        if attrs.get("actions_taken") and attrs.get("no_action_reason"):
            raise serializers.ValidationError("Record actions taken or a reason for no action, not both.")
        return attrs


class NerisValueSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()


class NerisValueSetsSerializer(serializers.Serializer):
    """Every NERIS choice list the incident report uses."""

    incident_type = NerisValueSerializer(many=True)
    action = NerisValueSerializer(many=True)
    no_action = NerisValueSerializer(many=True)
    response_mode = NerisValueSerializer(many=True)
    patient_care = NerisValueSerializer(many=True)
    patient_status = NerisValueSerializer(many=True)
    medical_disposition = NerisValueSerializer(many=True)
    investigation_need = NerisValueSerializer(many=True)
    investigation_type = NerisValueSerializer(many=True)
    arrival_conditions = NerisValueSerializer(many=True)
    building_damage = NerisValueSerializer(many=True)
    room = NerisValueSerializer(many=True)
    structure_cause = NerisValueSerializer(many=True)
    outside_cause = NerisValueSerializer(many=True)
    water_supply = NerisValueSerializer(many=True)
    suppression_appliance = NerisValueSerializer(many=True)
    presence = NerisValueSerializer(many=True)


def next_number(department, when=None):
    """The next incident number for the year, e.g. 2026-00042."""
    year = (when or timezone.now()).astimezone(timezone.get_current_timezone()).year
    prefix = f"{year}-"
    taken = Incident.objects.filter(department=department, number__startswith=prefix).values_list("number", flat=True)
    highest = max((int(n[len(prefix) :]) for n in taken if n[len(prefix) :].isdigit()), default=0)
    return f"{prefix}{highest + 1:05d}"
