from django.contrib import admin

from .models import Assignment, LeaveRequest, Platoon, RotationPattern, ShiftTrade


@admin.register(Platoon)
class PlatoonAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "department"]
    list_filter = ["department"]


@admin.register(RotationPattern)
class RotationPatternAdmin(admin.ModelAdmin):
    list_display = ["name", "anchor_date", "sequence", "shift_hours", "is_active", "department"]
    list_filter = ["department", "is_active"]


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ["user", "platoon", "station", "position"]
    list_filter = ["department", "platoon", "station"]


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ["user", "leave_type", "start_date", "end_date", "status"]
    list_filter = ["department", "status", "leave_type"]


@admin.register(ShiftTrade)
class ShiftTradeAdmin(admin.ModelAdmin):
    list_display = ["requester", "covering_member", "shift_date", "status"]
    list_filter = ["department", "status"]
