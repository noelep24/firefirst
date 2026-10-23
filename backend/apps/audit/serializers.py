from rest_framework import serializers

from .models import AuditEntry


class AuditEntrySerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditEntry
        fields = ["id", "created_at", "actor", "actor_name", "action", "model", "object_id", "object_repr", "changes"]

    def get_actor_name(self, obj) -> str:
        return str(obj.actor) if obj.actor else "System"
