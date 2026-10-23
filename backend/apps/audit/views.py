from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets

from apps.core.params import parse_date
from apps.core.permissions import IsDepartmentAdmin
from apps.core.tenancy import scope_queryset

from .models import AuditEntry
from .serializers import AuditEntrySerializer


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("start", OpenApiTypes.DATE, description="On or after this date"),
            OpenApiParameter("end", OpenApiTypes.DATE, description="On or before this date"),
        ]
    )
)
class AuditEntryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Who changed what. Department admins only."""

    queryset = AuditEntry.objects.select_related("actor")
    serializer_class = AuditEntrySerializer
    permission_classes = [IsDepartmentAdmin]
    filterset_fields = ["model", "object_id", "actor", "action"]
    search_fields = ["object_repr"]

    def get_queryset(self):
        qs = scope_queryset(super().get_queryset(), self.request.user.department)
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            qs = qs.filter(created_at__date__gte=parse_date(start, "start"))
        if end:
            qs = qs.filter(created_at__date__lte=parse_date(end, "end"))
        return qs
