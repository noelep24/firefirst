from django.conf import settings
from django.db import models

from apps.core.models import Department


class AuditEntry(models.Model):
    """One change to a department's data: who, what, when, and which fields changed."""

    class Action(models.TextChoices):
        CREATE = "create", "Created"
        UPDATE = "update", "Updated"
        DELETE = "delete", "Deleted"

    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="+")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=10, choices=Action.choices)
    model = models.CharField(max_length=60, help_text="app_label.ModelName")
    object_id = models.CharField(max_length=40)
    object_repr = models.CharField(max_length=200)
    # {field: [old, new]} for updates; {field: value} snapshot for creates and deletes.
    changes = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["department", "model", "object_id"])]
        verbose_name_plural = "audit entries"

    def __str__(self):
        return f"{self.actor or 'system'} {self.action} {self.model} {self.object_repr}"
