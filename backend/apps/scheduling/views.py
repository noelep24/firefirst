import datetime

from django.db.models import Q
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsDepartmentMember, IsOfficer, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet

from .models import Assignment, LeaveRequest, Platoon, RotationPattern, ShiftTrade
from .roster import build_roster
from .serializers import (
    AssignmentSerializer,
    LeaveRequestSerializer,
    PlatoonSerializer,
    ReviewSerializer,
    RosterSerializer,
    RotationPatternSerializer,
    ShiftDaySerializer,
    ShiftTradeSerializer,
)

MAX_CALENDAR_DAYS = 400


def parse_date(value, name):
    try:
        return datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({name: "Use YYYY-MM-DD."}) from None


class PlatoonViewSet(TenantViewSet):
    queryset = Platoon.objects.all()
    serializer_class = PlatoonSerializer
    permission_classes = [IsOfficerOrReadOnly]


class RotationPatternViewSet(TenantViewSet):
    queryset = RotationPattern.objects.all()
    serializer_class = RotationPatternSerializer
    permission_classes = [IsOfficerOrReadOnly]


class AssignmentViewSet(TenantViewSet):
    queryset = Assignment.objects.select_related("user", "platoon", "station")
    serializer_class = AssignmentSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["platoon", "station", "position", "user"]


class RosterView(APIView):
    """``GET /roster/?date=YYYY-MM-DD`` – who is on duty (defaults to today)."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(
        parameters=[OpenApiParameter("date", OpenApiTypes.DATE, required=False)],
        responses=RosterSerializer,
    )
    def get(self, request):
        raw = request.query_params.get("date")
        date = parse_date(raw, "date") if raw else timezone.localdate()
        return Response(build_roster(request.user.department, date))


class ShiftCalendarView(APIView):
    """``GET /shift-calendar/?start=&end=`` – the on-duty platoon for each day in a range."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(
        parameters=[
            OpenApiParameter("start", OpenApiTypes.DATE, required=True),
            OpenApiParameter("end", OpenApiTypes.DATE, required=True),
        ],
        responses=ShiftDaySerializer(many=True),
    )
    def get(self, request):
        start = parse_date(request.query_params.get("start"), "start")
        end = parse_date(request.query_params.get("end"), "end")
        if end < start or (end - start).days > MAX_CALENDAR_DAYS:
            raise ValidationError({"end": f"End must be after start and within {MAX_CALENDAR_DAYS} days."})
        pattern = RotationPattern.active_for(request.user.department)
        days = []
        day = start
        while day <= end:
            days.append({"date": day, "platoon": pattern.platoon_code_on(day) if pattern else None})
            day += datetime.timedelta(days=1)
        return Response(days)


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("start", OpenApiTypes.DATE, description="Overlapping on or after this date"),
            OpenApiParameter("end", OpenApiTypes.DATE, description="Overlapping on or before this date"),
        ]
    )
)
class LeaveRequestViewSet(TenantViewSet):
    """Members see and file their own leave; officers see everyone's and approve or deny."""

    queryset = LeaveRequest.objects.select_related("user")
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsDepartmentMember]
    filterset_fields = ["user", "status", "leave_type"]

    def get_queryset(self):
        qs = super().get_queryset()
        if not self.request.user.is_officer:
            qs = qs.filter(user=self.request.user)
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            qs = qs.filter(end_date__gte=parse_date(start, "start"))
        if end:
            qs = qs.filter(start_date__lte=parse_date(end, "end"))
        return qs

    def perform_create(self, serializer):
        user = serializer.validated_data.get("user", self.request.user)
        serializer.save(department=self.request.user.department, user=user)

    def perform_update(self, serializer):
        if serializer.instance.status != LeaveRequest.Status.PENDING:
            raise ValidationError("Only pending requests can be edited.")
        serializer.save()

    def perform_destroy(self, instance):
        raise PermissionDenied("Cancel the request instead of deleting it.")

    def _review(self, request, new_status):
        leave = self.get_object()
        if leave.status != LeaveRequest.Status.PENDING:
            raise ValidationError("This request has already been reviewed.")
        review = ReviewSerializer(data=request.data)
        review.is_valid(raise_exception=True)
        leave.status = new_status
        leave.reviewed_by = request.user
        leave.reviewed_at = timezone.now()
        leave.review_note = review.validated_data.get("note", "")
        leave.save()
        return Response(LeaveRequestSerializer(leave, context=self.get_serializer_context()).data)

    @extend_schema(request=ReviewSerializer, responses=LeaveRequestSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer], serializer_class=ReviewSerializer)
    def approve(self, request, pk=None):
        return self._review(request, LeaveRequest.Status.APPROVED)

    @extend_schema(request=ReviewSerializer, responses=LeaveRequestSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer], serializer_class=ReviewSerializer)
    def deny(self, request, pk=None):
        return self._review(request, LeaveRequest.Status.DENIED)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        leave = self.get_object()
        if leave.user != request.user and not request.user.is_officer:
            raise PermissionDenied()
        if leave.status in (LeaveRequest.Status.DENIED, LeaveRequest.Status.CANCELLED):
            raise ValidationError("This request is already closed.")
        leave.status = LeaveRequest.Status.CANCELLED
        leave.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(leave).data)


class ShiftTradeViewSet(TenantViewSet):
    """Members see trades they're part of; officers see all."""

    queryset = ShiftTrade.objects.select_related("requester", "covering_member")
    serializer_class = ShiftTradeSerializer
    permission_classes = [IsDepartmentMember]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["status", "shift_date"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_officer:
            qs = qs.filter(Q(requester=user) | Q(covering_member=user))
        return qs

    def perform_create(self, serializer):
        serializer.save(department=self.request.user.department, requester=self.request.user)

    def _transition(self, trade, allowed_from, new_status, reviewer=None):
        if trade.status not in allowed_from:
            raise ValidationError(f"Can't do that while the trade is '{trade.get_status_display()}'.")
        trade.status = new_status
        if reviewer:
            trade.reviewed_by = reviewer
            trade.reviewed_at = timezone.now()
        trade.save()
        return Response(self.get_serializer(trade).data, status=status.HTTP_200_OK)

    def _covering_member_only(self, trade):
        if trade.covering_member != self.request.user:
            raise PermissionDenied("Only the covering member can respond to this trade.")

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        trade = self.get_object()
        self._covering_member_only(trade)
        return self._transition(trade, [ShiftTrade.Status.PENDING_PARTNER], ShiftTrade.Status.PENDING_APPROVAL)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        trade = self.get_object()
        self._covering_member_only(trade)
        return self._transition(trade, [ShiftTrade.Status.PENDING_PARTNER], ShiftTrade.Status.DECLINED)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer])
    def approve(self, request, pk=None):
        trade = self.get_object()
        return self._transition(
            trade, [ShiftTrade.Status.PENDING_APPROVAL], ShiftTrade.Status.APPROVED, reviewer=request.user
        )

    @extend_schema(request=None)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer])
    def deny(self, request, pk=None):
        trade = self.get_object()
        return self._transition(
            trade,
            [ShiftTrade.Status.PENDING_PARTNER, ShiftTrade.Status.PENDING_APPROVAL],
            ShiftTrade.Status.DENIED,
            reviewer=request.user,
        )

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        trade = self.get_object()
        if trade.requester != request.user:
            raise PermissionDenied("Only the requester can cancel a trade.")
        return self._transition(
            trade,
            [ShiftTrade.Status.PENDING_PARTNER, ShiftTrade.Status.PENDING_APPROVAL, ShiftTrade.Status.APPROVED],
            ShiftTrade.Status.CANCELLED,
        )
