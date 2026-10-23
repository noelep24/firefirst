from django.db.models import Sum
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.permissions import IsDepartmentMember, IsOfficer, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet
from apps.scheduling.views import parse_date

from .models import Attendance, Event
from .serializers import AttendanceMarkSerializer, EventSerializer, RsvpSerializer


class EventViewSet(TenantViewSet):
    """``?start=&end=`` (YYYY-MM-DD) returns events overlapping that range."""

    queryset = Event.objects.select_related("station").prefetch_related("attendance__user")
    serializer_class = EventSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["category", "station", "is_mandatory"]
    search_fields = ["title", "description", "location"]

    def get_queryset(self):
        qs = super().get_queryset()
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            qs = qs.filter(ends_at__date__gte=parse_date(start, "start"))
        if end:
            qs = qs.filter(starts_at__date__lte=parse_date(end, "end"))
        return qs

    def perform_create(self, serializer):
        serializer.save(department=self.request.user.department, created_by=self.request.user)

    @extend_schema(request=RsvpSerializer, responses=EventSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsDepartmentMember], serializer_class=RsvpSerializer)
    def rsvp(self, request, pk=None):
        event = self.get_object()
        rsvp = RsvpSerializer(data=request.data)
        rsvp.is_valid(raise_exception=True)
        Attendance.objects.update_or_create(
            event=event, user=request.user, defaults={"status": rsvp.validated_data["status"]}
        )
        return Response(EventSerializer(self.get_object(), context=self.get_serializer_context()).data)

    @extend_schema(request=AttendanceMarkSerializer, responses=EventSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer], serializer_class=AttendanceMarkSerializer)
    def attendance(self, request, pk=None):
        """Officers record who actually showed up. Attended members earn the event's training hours."""
        event = self.get_object()
        marks = AttendanceMarkSerializer(data=request.data, context={"request": request})
        marks.is_valid(raise_exception=True)
        attended = marks.validated_data.get("attended", [])
        absent = marks.validated_data.get("absent", [])
        if set(attended) & set(absent):
            raise ValidationError("A member can't be both attended and absent.")
        for users, status in ((attended, Attendance.Status.ATTENDED), (absent, Attendance.Status.ABSENT)):
            for user in users:
                Attendance.objects.update_or_create(event=event, user=user, defaults={"status": status})
        return Response(EventSerializer(self.get_object(), context=self.get_serializer_context()).data)

    @extend_schema(
        responses=inline_serializer(
            "TrainingHours",
            {
                "user": serializers.IntegerField(),
                "name": serializers.CharField(),
                "hours": serializers.DecimalField(9, 2),
            },
            many=True,
        )
    )
    @action(detail=False, methods=["get"], url_path="training-hours")
    def training_hours(self, request):
        """Training hours per member from attended events, optionally within ``?start=&end=``."""
        attendance = Attendance.objects.filter(
            event__department=request.user.department,
            status=Attendance.Status.ATTENDED,
            event__training_hours__isnull=False,
        )
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        if start:
            attendance = attendance.filter(event__starts_at__date__gte=parse_date(start, "start"))
        if end:
            attendance = attendance.filter(event__starts_at__date__lte=parse_date(end, "end"))
        if not request.user.is_officer:
            attendance = attendance.filter(user=request.user)
        rows = (
            attendance.values("user", "user__first_name", "user__last_name")
            .annotate(hours=Sum("event__training_hours"))
            .order_by("user__last_name", "user__first_name")
        )
        return Response(
            [
                {
                    "user": r["user"],
                    "name": f"{r['user__first_name']} {r['user__last_name']}".strip(),
                    "hours": r["hours"],
                }
                for r in rows
            ]
        )
