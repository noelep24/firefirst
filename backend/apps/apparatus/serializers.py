from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.models import Station
from apps.core.tenancy import TenantScopedFieldsMixin, TenantSerializer

from .models import (
    Apparatus,
    ApparatusMove,
    ChecklistItem,
    ChecklistTemplate,
    Inspection,
    InspectionResult,
    MaintenanceSchedule,
    ServiceRecord,
    WorkOrder,
)


class ApparatusMoveSerializer(serializers.ModelSerializer):
    station_name = serializers.StringRelatedField(source="station", read_only=True)
    covering_for_unit = serializers.CharField(source="covering_for.unit_number", read_only=True, default=None)

    class Meta:
        model = ApparatusMove
        fields = [
            "id",
            "station",
            "station_name",
            "starts_on",
            "ends_on",
            "covering_for",
            "covering_for_unit",
            "crew_moves",
            "reason",
        ]


class MoveRequestSerializer(TenantScopedFieldsMixin, serializers.Serializer):
    station = serializers.PrimaryKeyRelatedField(queryset=Station.objects.all())
    temporary = serializers.BooleanField(help_text="Temporary moves leave the home station alone and end on their own")
    until = serializers.DateField(
        required=False, allow_null=True, help_text="Last day away (temporary only); blank until returned"
    )
    crew_moves = serializers.BooleanField(default=False, help_text="The rig's own crew goes with it")
    covering_for = serializers.PrimaryKeyRelatedField(
        queryset=Apparatus.objects.all(),
        required=False,
        allow_null=True,
        help_text="Temporary only: a rig whose crew rides this one meanwhile",
    )
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate(self, attrs):
        apparatus = self.context["apparatus"]
        today = timezone.localdate()
        temporary = attrs["temporary"]
        if not temporary and (attrs.get("until") or attrs.get("covering_for")):
            raise serializers.ValidationError("Only a temporary move can have an end date or cover for a rig.")
        if attrs.get("until") and attrs["until"] < today:
            raise serializers.ValidationError({"until": "The end date has passed."})
        if attrs.get("covering_for") == apparatus:
            raise serializers.ValidationError({"covering_for": "A rig can't cover for itself."})
        if temporary and attrs["station"] == apparatus.station:
            raise serializers.ValidationError(
                {"station": f"That's {apparatus}'s home station. Return it instead of moving it there."}
            )
        if not temporary and attrs["station"] == apparatus.station:
            raise serializers.ValidationError({"station": f"{apparatus} is already based there."})
        return attrs


class ApparatusSerializer(TenantSerializer):
    station_name = serializers.StringRelatedField(source="station", read_only=True)
    open_work_orders = serializers.IntegerField(read_only=True)
    current_move = serializers.SerializerMethodField(help_text="Where the rig is temporarily, if it's away today")

    @extend_schema_field(ApparatusMoveSerializer(allow_null=True))
    def get_current_move(self, apparatus):
        today = timezone.localdate()
        if hasattr(apparatus, "pending_moves"):  # prefetched by the viewset
            move = next((m for m in apparatus.pending_moves if m.is_active_on(today)), None)
        else:
            move = ApparatusMove.active_on(apparatus.department, today).get(apparatus.id)
        return ApparatusMoveSerializer(move).data if move else None

    class Meta:
        model = Apparatus
        fields = [
            "id",
            "unit_number",
            "apparatus_type",
            "station",
            "station_name",
            "status",
            "make",
            "model",
            "year",
            "vin",
            "license_plate",
            "mileage",
            "engine_hours",
            "notes",
            "open_work_orders",
            "current_move",
        ]


class ChecklistItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)

    class Meta:
        model = ChecklistItem
        fields = ["id", "section", "prompt", "order"]


class ChecklistTemplateSerializer(TenantSerializer):
    items = ChecklistItemSerializer(many=True)

    class Meta:
        model = ChecklistTemplate
        fields = ["id", "name", "apparatus_type", "is_active", "items"]

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        template = ChecklistTemplate.objects.create(**validated_data)
        for position, item in enumerate(items):
            item.pop("id", None)
            item.setdefault("order", position)
            ChecklistItem.objects.create(template=template, **item)
        return template

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        instance = super().update(instance, validated_data)
        if items is not None:
            # Items with an id are updated, new ones created, and missing ones
            # removed unless past inspections reference them.
            existing = {item.id: item for item in instance.items.all()}
            keep = set()
            for position, data in enumerate(items):
                item_id = data.pop("id", None)
                data.setdefault("order", position)
                if item_id in existing:
                    item = existing[item_id]
                    for key, value in data.items():
                        setattr(item, key, value)
                    item.save()
                    keep.add(item_id)
                else:
                    ChecklistItem.objects.create(template=instance, **data)
            used = set(
                InspectionResult.objects.filter(checklist_item__template=instance).values_list(
                    "checklist_item_id", flat=True
                )
            )
            removable = set(existing) - keep - used
            ChecklistItem.objects.filter(id__in=removable).delete()
        return instance


class InspectionResultSerializer(serializers.ModelSerializer):
    prompt = serializers.CharField(source="checklist_item.prompt", read_only=True)
    checklist_item = serializers.PrimaryKeyRelatedField(queryset=ChecklistItem.objects.all())

    class Meta:
        model = InspectionResult
        fields = ["checklist_item", "prompt", "status", "note"]


class InspectionSerializer(TenantSerializer):
    results = InspectionResultSerializer(many=True)
    performed_by = serializers.PrimaryKeyRelatedField(read_only=True)
    deficiency_count = serializers.IntegerField(read_only=True)
    create_work_orders = serializers.BooleanField(
        write_only=True,
        default=True,
        help_text="Open a work order for each deficient item.",
    )

    class Meta:
        model = Inspection
        fields = [
            "id",
            "apparatus",
            "template",
            "performed_by",
            "performed_at",
            "mileage",
            "engine_hours",
            "notes",
            "results",
            "deficiency_count",
            "create_work_orders",
        ]

    def validate(self, attrs):
        template = attrs["template"]
        apparatus = attrs["apparatus"]
        if template.apparatus_type and template.apparatus_type != apparatus.apparatus_type:
            raise serializers.ValidationError({"template": "This checklist is for a different apparatus type."})
        for result in attrs["results"]:
            if result["checklist_item"].template_id != template.id:
                raise serializers.ValidationError({"results": "Every result must belong to the selected checklist."})
            if result["status"] == InspectionResult.Status.DEFICIENT and not result.get("note"):
                raise serializers.ValidationError({"results": "Describe each deficient item in its note."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        results = validated_data.pop("results")
        create_work_orders = validated_data.pop("create_work_orders")
        inspection = Inspection.objects.create(**validated_data)
        InspectionResult.objects.bulk_create(InspectionResult(inspection=inspection, **r) for r in results)
        inspection.apparatus.record_readings(inspection.mileage, inspection.engine_hours)
        if create_work_orders:
            for result in results:
                if result["status"] == InspectionResult.Status.DEFICIENT:
                    WorkOrder.objects.create(
                        department=inspection.department,
                        apparatus=inspection.apparatus,
                        title=result["checklist_item"].prompt[:200],
                        description=result["note"],
                        reported_by=inspection.performed_by,
                        source_inspection=inspection,
                    )
        return inspection


class WorkOrderSerializer(TenantSerializer):
    reported_by = serializers.PrimaryKeyRelatedField(read_only=True)
    apparatus_unit = serializers.CharField(source="apparatus.unit_number", read_only=True)

    class Meta:
        model = WorkOrder
        fields = [
            "id",
            "apparatus",
            "apparatus_unit",
            "title",
            "description",
            "priority",
            "status",
            "takes_out_of_service",
            "reported_by",
            "assigned_to",
            "source_inspection",
            "created_at",
            "completed_at",
            "resolution",
            "cost",
        ]
        read_only_fields = ["source_inspection", "completed_at"]


class MaintenanceScheduleSerializer(TenantSerializer):
    apparatus_unit = serializers.CharField(source="apparatus.unit_number", read_only=True)
    next_due_date = serializers.DateField(read_only=True)
    next_due_mileage = serializers.IntegerField(read_only=True)
    next_due_engine_hours = serializers.DecimalField(max_digits=9, decimal_places=1, read_only=True)
    is_due = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceSchedule
        fields = [
            "id",
            "apparatus",
            "apparatus_unit",
            "task",
            "interval_days",
            "interval_miles",
            "interval_hours",
            "last_performed_on",
            "last_mileage",
            "last_engine_hours",
            "next_due_date",
            "next_due_mileage",
            "next_due_engine_hours",
            "is_due",
            "notes",
        ]

    def get_is_due(self, obj) -> bool:
        return obj.is_due()

    def validate(self, attrs):
        intervals = [
            attrs.get(k, getattr(self.instance, k, None)) for k in ("interval_days", "interval_miles", "interval_hours")
        ]
        if not any(intervals):
            raise serializers.ValidationError("Set at least one interval (days, miles or engine hours).")
        return attrs


class ServiceRecordSerializer(TenantSerializer):
    class Meta:
        model = ServiceRecord
        fields = [
            "id",
            "apparatus",
            "schedule",
            "description",
            "performed_on",
            "performed_by",
            "mileage",
            "engine_hours",
            "cost",
            "passed",
            "notes",
        ]

    def validate(self, attrs):
        schedule = attrs.get("schedule")
        if schedule and schedule.apparatus_id != attrs["apparatus"].id:
            raise serializers.ValidationError({"schedule": "Schedule belongs to a different apparatus."})
        return attrs
