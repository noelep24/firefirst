from django.contrib import admin

from .models import AuditEntry


@admin.register(AuditEntry)
class AuditEntryAdmin(admin.ModelAdmin):
    list_display = ["created_at", "department", "actor", "action", "model", "object_repr"]
    list_filter = ["department", "action", "model"]
    search_fields = ["object_repr"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
