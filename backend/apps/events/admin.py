from django.contrib import admin

from .models import Attendance, Event


class AttendanceInline(admin.TabularInline):
    model = Attendance
    extra = 0


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "station", "starts_at", "is_mandatory", "department"]
    list_filter = ["department", "category", "is_mandatory"]
    search_fields = ["title"]
    inlines = [AttendanceInline]
