from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Department, Station, User


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "timezone", "is_active"]
    prepopulated_fields = {"slug": ["name"]}


@admin.register(Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ["__str__", "department", "address"]
    list_filter = ["department"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "get_full_name", "department", "role", "rank", "home_station"]
    list_filter = ["department", "role", "is_active"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Department", {"fields": ["department", "role", "employee_id", "rank", "phone", "home_station"]}),
    )
