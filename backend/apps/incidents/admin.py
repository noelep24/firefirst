from django.contrib import admin

from .models import Incident, IncidentUnit


class IncidentUnitInline(admin.TabularInline):
    model = IncidentUnit
    extra = 0
    fields = ["unit", "apparatus", "response_mode", "dispatched_at", "on_scene_at", "cleared_at"]


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ["number", "department", "alarm_at", "address", "status"]
    list_filter = ["department", "status"]
    search_fields = ["number", "address"]
    inlines = [IncidentUnitInline]
