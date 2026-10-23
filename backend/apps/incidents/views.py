from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsDepartmentMember, IsOfficer
from apps.core.tenancy import TenantViewSet
from apps.scheduling.roster import build_roster

from . import neris
from .models import Incident, IncidentUnit
from .serializers import IncidentSerializer, IncidentUnitSerializer, NerisValueSetsSerializer, next_number


def _guard_complete(request, incident):
    """Anyone can write a draft; a completed report only changes when an officer reopens or edits it."""
    if incident.status == Incident.Status.COMPLETE and not request.user.is_officer:
        raise PermissionDenied("This report is complete. Ask an officer to reopen it.")


class IncidentViewSet(TenantViewSet):
    """Incident reports. Any member can start and fill one in; officers delete and reopen."""

    queryset = Incident.objects.select_related("station", "created_by").prefetch_related("units__crew")
    serializer_class = IncidentSerializer
    permission_classes = [IsDepartmentMember]
    filterset_fields = ["status", "station"]
    search_fields = ["number", "address", "city", "narrative"]
    ordering_fields = ["alarm_at", "number"]

    def perform_create(self, serializer):
        department = self.request.user.department
        alarm_at = serializer.validated_data.get("alarm_at")
        if serializer.validated_data.get("number"):
            serializer.save(department=department, created_by=self.request.user)
            return
        # Numbers are per department and year; retry if two reports start at the same moment.
        for _ in range(5):
            try:
                with transaction.atomic():
                    serializer.save(
                        department=department, created_by=self.request.user, number=next_number(department, alarm_at)
                    )
                return
            except IntegrityError:
                continue
        raise ValidationError({"number": "Couldn't number this report. Try again."})

    def perform_update(self, serializer):
        _guard_complete(self.request, serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        if not self.request.user.is_officer:
            raise PermissionDenied("Only officers can delete incident reports.")
        instance.delete()

    @extend_schema(request=None, responses=IncidentSerializer)
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Mark the report complete once nothing NERIS needs is missing."""
        incident = self.get_object()
        todo = neris.missing(incident, list(incident.units.all()))
        if todo:
            return Response(
                {"detail": "This report isn't finished.", "missing": todo}, status=status.HTTP_400_BAD_REQUEST
            )
        incident.status = Incident.Status.COMPLETE
        incident.completed_by = request.user
        incident.completed_at = timezone.now()
        incident.save(update_fields=["status", "completed_by", "completed_at", "updated_at"])
        return Response(self.get_serializer(incident).data)

    @extend_schema(request=None, responses=IncidentSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer])
    def reopen(self, request, pk=None):
        """Send a completed report back to draft for changes (officers)."""
        incident = self.get_object()
        incident.status = Incident.Status.DRAFT
        incident.completed_by = None
        incident.completed_at = None
        incident.save(update_fields=["status", "completed_by", "completed_at", "updated_at"])
        return Response(self.get_serializer(incident).data)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"], url_path="neris")
    def neris_export(self, request, pk=None):
        """The report in NERIS incident format, for review or upload."""
        incident = self.get_object()
        body = neris.payload(incident, list(incident.units.all()), request.user.department.neris_id or None)
        return Response(body)


class IncidentUnitViewSet(TenantViewSet):
    """Units on an incident. A rig added without a crew gets the crew riding it that day."""

    queryset = IncidentUnit.objects.select_related("incident", "apparatus").prefetch_related("crew")
    serializer_class = IncidentUnitSerializer
    permission_classes = [IsDepartmentMember]
    filterset_fields = ["incident"]
    pagination_class = None

    def perform_create(self, serializer):
        incident = serializer.validated_data["incident"]
        _guard_complete(self.request, incident)
        unit = serializer.save(department=self.request.user.department)
        if "crew" not in serializer.validated_data and unit.apparatus_id:
            day = timezone.localtime(unit.dispatched_at or incident.alarm_at).date()
            riders = [
                p["user"]
                for p in build_roster(incident.department, day)["working"]
                if p["apparatus"] == unit.apparatus_id
            ]
            unit.crew.set(riders)
            if unit.staffing is None:
                unit.staffing = len(riders) or None
                unit.save(update_fields=["staffing", "updated_at"])

    def perform_update(self, serializer):
        _guard_complete(self.request, serializer.instance.incident)
        if (
            "incident" in serializer.validated_data
            and serializer.validated_data["incident"] != serializer.instance.incident
        ):
            raise ValidationError({"incident": "A unit can't move to another incident."})
        serializer.save()

    def perform_destroy(self, instance):
        _guard_complete(self.request, instance.incident)
        instance.delete()


class NerisValueSetsView(APIView):
    """``GET /neris/value-sets/`` – the NERIS choice lists the incident report uses."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(responses=NerisValueSetsSerializer)
    def get(self, request):
        return Response(neris.value_sets())
