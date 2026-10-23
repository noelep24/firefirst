from django.contrib import admin

from .models import (
    Apparatus,
    ChecklistItem,
    ChecklistTemplate,
    Inspection,
    InspectionResult,
    MaintenanceSchedule,
    ServiceRecord,
    WorkOrder,
)


@admin.register(Apparatus)
class ApparatusAdmin(admin.ModelAdmin):
    list_display = ["unit_number", "apparatus_type", "station", "status", "mileage", "department"]
    list_filter = ["department", "status", "apparatus_type"]
    search_fields = ["unit_number", "vin"]


class ChecklistItemInline(admin.TabularInline):
    model = ChecklistItem
    extra = 1


@admin.register(ChecklistTemplate)
class ChecklistTemplateAdmin(admin.ModelAdmin):
    list_display = ["name", "apparatus_type", "is_active", "department"]
    inlines = [ChecklistItemInline]


class InspectionResultInline(admin.TabularInline):
    model = InspectionResult
    extra = 0


@admin.register(Inspection)
class InspectionAdmin(admin.ModelAdmin):
    list_display = ["apparatus", "template", "performed_by", "performed_at"]
    list_filter = ["department", "template"]
    inlines = [InspectionResultInline]


@admin.register(WorkOrder)
class WorkOrderAdmin(admin.ModelAdmin):
    list_display = ["title", "apparatus", "priority", "status", "takes_out_of_service", "created_at"]
    list_filter = ["department", "status", "priority"]


@admin.register(MaintenanceSchedule)
class MaintenanceScheduleAdmin(admin.ModelAdmin):
    list_display = ["task", "apparatus", "interval_days", "interval_miles", "last_performed_on"]
    list_filter = ["department"]


@admin.register(ServiceRecord)
class ServiceRecordAdmin(admin.ModelAdmin):
    list_display = ["description", "apparatus", "performed_on", "cost", "passed"]
    list_filter = ["department"]
