from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsDepartmentMember, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet

from .models import Apparatus, ChecklistTemplate, Inspection, MaintenanceSchedule, ServiceRecord, WorkOrder
from .serializers import (
    ApparatusSerializer,
    ChecklistTemplateSerializer,
    InspectionSerializer,
    MaintenanceScheduleSerializer,
    ServiceRecordSerializer,
    WorkOrderSerializer,
)


class ApparatusViewSet(TenantViewSet):
    queryset = Apparatus.objects.select_related("station").annotate(
        open_work_orders=Count("work_orders", filter=Q(work_orders__status__in=WorkOrder.OPEN_STATUSES))
    )
    serializer_class = ApparatusSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["station", "status", "apparatus_type"]
    search_fields = ["unit_number", "vin", "make", "model"]

    @extend_schema(responses=ChecklistTemplateSerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def checklists(self, request, pk=None):
        """Active checklists that can be used for this apparatus."""
        apparatus = self.get_object()
        templates = ChecklistTemplate.objects.filter(department=request.user.department, is_active=True).filter(
            Q(apparatus_type="") | Q(apparatus_type=apparatus.apparatus_type)
        )
        serializer = ChecklistTemplateSerializer(
            templates.prefetch_related("items"), many=True, context={"request": request}
        )
        return Response(serializer.data)


class ChecklistTemplateViewSet(TenantViewSet):
    queryset = ChecklistTemplate.objects.prefetch_related("items")
    serializer_class = ChecklistTemplateSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["apparatus_type", "is_active"]


class InspectionViewSet(TenantViewSet):
    """Any member can log a rig check. Inspections are a record, so they can't be edited afterwards."""

    queryset = Inspection.objects.select_related("apparatus", "template", "performed_by").prefetch_related(
        "results__checklist_item"
    )
    serializer_class = InspectionSerializer
    permission_classes = [IsDepartmentMember]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["apparatus", "template", "performed_by"]

    def perform_create(self, serializer):
        serializer.save(department=self.request.user.department, performed_by=self.request.user)


@extend_schema_view(
    list=extend_schema(parameters=[OpenApiParameter("open", OpenApiTypes.BOOL, description="Only open work orders")])
)
class WorkOrderViewSet(TenantViewSet):
    """Any member can report a problem; only officers can delete."""

    queryset = WorkOrder.objects.select_related("apparatus")
    serializer_class = WorkOrderSerializer
    permission_classes = [IsDepartmentMember]
    filterset_fields = ["apparatus", "status", "priority", "takes_out_of_service"]
    search_fields = ["title", "description", "apparatus__unit_number"]
    ordering_fields = ["created_at", "priority", "status"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("open") in ("1", "true"):
            qs = qs.filter(status__in=WorkOrder.OPEN_STATUSES)
        return qs

    def get_permissions(self):
        if self.action == "destroy":
            return [IsOfficerOrReadOnly()]
        return super().get_permissions()

    def perform_create(self, serializer):
        serializer.save(department=self.request.user.department, reported_by=self.request.user)

    def perform_destroy(self, instance):
        apparatus = instance.apparatus
        instance.delete()
        apparatus.refresh_status_from_work_orders()


class MaintenanceScheduleViewSet(TenantViewSet):
    queryset = MaintenanceSchedule.objects.select_related("apparatus")
    serializer_class = MaintenanceScheduleSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["apparatus"]

    @extend_schema(
        parameters=[OpenApiParameter("days", OpenApiTypes.INT, description="Lead time in days (default 14)")],
        responses=MaintenanceScheduleSerializer(many=True),
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def due(self, request):
        """Schedules that are due now, or within ``?days=`` (default 14)."""
        days = int(request.query_params.get("days", 14))
        due = [s for s in self.filter_queryset(self.get_queryset()) if s.is_due(warning_days=days)]
        return Response(self.get_serializer(due, many=True).data)


class ServiceRecordViewSet(TenantViewSet):
    queryset = ServiceRecord.objects.select_related("apparatus", "schedule")
    serializer_class = ServiceRecordSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["apparatus", "schedule"]
