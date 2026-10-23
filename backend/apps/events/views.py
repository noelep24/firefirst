import secrets

from django.db.models import Sum
from django.http import HttpResponse
from django.urls import reverse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import User
from apps.core.params import parse_date
from apps.core.permissions import IsDepartmentMember, IsOfficer, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet

from .ical import build_feed
from .models import Attendance, Event
from .serializers import AttendanceMarkSerializer, CalendarLinkSerializer, EventSerializer, RsvpSerializer


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("start", OpenApiTypes.DATE, description="Overlapping on or after this date"),
            OpenApiParameter("end", OpenApiTypes.DATE, description="Overlapping on or before this date"),
        ]
    ),
    destroy=extend_schema(
        parameters=[
            OpenApiParameter("scope", OpenApiTypes.STR, enum=["this", "following"], description="For repeating events")
        ]
    ),
)
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

    def perform_destroy(self, instance):
        if instance.series and self.request.query_params.get("scope") == "following":
            Event.objects.filter(
                department=instance.department, series=instance.series, starts_at__gte=instance.starts_at
            ).delete()
        else:
            instance.delete()

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
    @action(detail=False, methods=["get"], url_path="training-hours", pagination_class=None)
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


class CalendarFeedView(APIView):
    """The member's personal iCalendar feed. The secret token in the URL is the only credential,
    so calendar apps can subscribe; members can regenerate it to revoke an old link."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={(200, "text/calendar"): OpenApiTypes.STR})
    def get(self, request, token):
        user = User.objects.filter(calendar_token=token, is_active=True, department__isnull=False).first()
        if not token or user is None:
            raise NotFound("This calendar link is no longer valid.")
        response = HttpResponse(build_feed(user), content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = 'inline; filename="firefirst.ics"'
        return response


class MyCalendarFeedView(APIView):
    """``GET`` the personal calendar link (created on first use); ``POST`` to replace it with a new one."""

    permission_classes = [IsDepartmentMember]

    def _response(self, request, user):
        url = request.build_absolute_uri(reverse("calendar-feed", args=[user.calendar_token]))
        return Response({"url": url, "webcal_url": "webcal://" + url.split("://", 1)[1]})

    @extend_schema(responses=CalendarLinkSerializer)
    def get(self, request):
        user = request.user
        if not user.calendar_token:
            user.calendar_token = secrets.token_urlsafe(24)
            user.save(update_fields=["calendar_token"])
        return self._response(request, user)

    @extend_schema(request=None, responses=CalendarLinkSerializer)
    def post(self, request):
        user = request.user
        user.calendar_token = secrets.token_urlsafe(24)
        user.save(update_fields=["calendar_token"])
        return self._response(request, user)
