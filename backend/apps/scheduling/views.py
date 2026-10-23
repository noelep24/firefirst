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

from apps.core.models import Station, User
from apps.core.params import parse_date
from apps.core.permissions import IsDepartmentAdmin, IsDepartmentMember, IsOfficer, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet

from . import offers
from .models import (
    Assignment,
    LeaveRequest,
    OvertimeOffer,
    OvertimeSettings,
    OvertimeShift,
    Platoon,
    RotationPattern,
    ShiftTrade,
    StaffingRule,
    Vacancy,
)
from .overtime import overtime_list
from .roster import build_roster, leave_impact, station_board
from .serializers import (
    AssignmentSerializer,
    HireSerializer,
    LeaveRequestSerializer,
    OvertimeBoardSerializer,
    OvertimeOfferSerializer,
    OvertimeSettingsSerializer,
    OvertimeShiftSerializer,
    PlatoonSerializer,
    ReviewSerializer,
    RosterSerializer,
    RotationPatternSerializer,
    ShiftDaySerializer,
    ShiftTradeSerializer,
    StaffingDaySerializer,
    StaffingRuleSerializer,
    StationBoardSerializer,
    VacancySerializer,
)

MAX_CALENDAR_DAYS = 400


class PlatoonViewSet(TenantViewSet):
    queryset = Platoon.objects.all()
    serializer_class = PlatoonSerializer
    permission_classes = [IsOfficerOrReadOnly]


class RotationPatternViewSet(TenantViewSet):
    queryset = RotationPattern.objects.all()
    serializer_class = RotationPatternSerializer
    permission_classes = [IsOfficerOrReadOnly]


class AssignmentViewSet(TenantViewSet):
    queryset = Assignment.objects.select_related("user", "platoon", "station", "apparatus")
    serializer_class = AssignmentSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["platoon", "station", "position", "user"]


class StaffingRuleViewSet(TenantViewSet):
    queryset = StaffingRule.objects.select_related("station", "certification_type")
    serializer_class = StaffingRuleSerializer
    permission_classes = [IsOfficerOrReadOnly]


MAX_OUTLOOK_DAYS = 62


class StaffingOutlookView(APIView):
    """``GET /staffing/?start=&end=`` – days in the range whose crew misses a staffing rule."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(
        parameters=[
            OpenApiParameter("start", OpenApiTypes.DATE, required=True),
            OpenApiParameter("end", OpenApiTypes.DATE, required=True),
        ],
        responses=StaffingDaySerializer(many=True),
    )
    def get(self, request):
        start = parse_date(request.query_params.get("start"), "start")
        end = parse_date(request.query_params.get("end"), "end")
        if end < start or (end - start).days > MAX_OUTLOOK_DAYS:
            raise ValidationError({"end": f"End must be after start and within {MAX_OUTLOOK_DAYS} days."})
        days = []
        day = start
        while day <= end:
            roster = build_roster(request.user.department, day)
            if roster["shortfalls"]:
                days.append({"date": day, "platoon": roster["platoon"], "shortfalls": roster["shortfalls"]})
            day += datetime.timedelta(days=1)
        return Response(days)


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


class OvertimeShiftViewSet(TenantViewSet):
    """Overtime worked. Everyone can see it; officers record it."""

    queryset = OvertimeShift.objects.select_related("user", "filling_for", "station")
    serializer_class = OvertimeShiftSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["user", "date", "mandatory"]

    def perform_create(self, serializer):
        serializer.save(department=self.request.user.department, recorded_by=self.request.user)


class OvertimeSettingsView(APIView):
    """``/overtime-settings/`` – how the department fills overtime. Everyone can read it; admins change it."""

    def get_permissions(self):
        return [IsDepartmentAdmin()] if self.request.method == "PATCH" else [IsDepartmentMember()]

    @extend_schema(responses=OvertimeSettingsSerializer)
    def get(self, request):
        return Response(OvertimeSettingsSerializer(OvertimeSettings.for_department(request.user.department)).data)

    @extend_schema(request=OvertimeSettingsSerializer, responses=OvertimeSettingsSerializer)
    def patch(self, request):
        serializer = OvertimeSettingsSerializer(
            OvertimeSettings.for_department(request.user.department), data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class VacancyViewSet(TenantViewSet):
    """Seats to fill with overtime. Posting one offers it to volunteers, then hires off the list."""

    queryset = Vacancy.objects.select_related("filling_for", "station", "overtime_shift__user").prefetch_related(
        "offers__user"
    )
    serializer_class = VacancySerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["date", "status"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(status__in=[Vacancy.Status.OFFERED, Vacancy.Status.UNFILLED])
        return queryset

    @extend_schema(parameters=[OpenApiParameter("open", OpenApiTypes.BOOL, description="Only vacancies still open")])
    def list(self, request, *args, **kwargs):
        offers.process_due(request.user.department)
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        vacancy = serializer.save(department=self.request.user.department, created_by=self.request.user)
        offers.open_vacancy(vacancy)

    def _open(self):
        vacancy = self.get_object()
        if vacancy.status not in (Vacancy.Status.OFFERED, Vacancy.Status.UNFILLED):
            raise ValidationError("This vacancy is already closed.")
        return vacancy

    def _respond(self, vacancy):
        fresh = self.get_queryset().get(pk=vacancy.pk)
        return Response(VacancySerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(request=HireSerializer, responses=VacancySerializer)
    @action(detail=True, methods=["post"])
    def hire(self, request, pk=None):
        """Hire a particular member now (a volunteer, or anyone available), skipping the wait."""
        vacancy = self._open()
        body = HireSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if body.validated_data["user"] not in {m["user"] for m in offers.available(vacancy)}:
            raise ValidationError({"user": "They aren't available to work that day."})
        user = User.objects.get(pk=body.validated_data["user"])
        volunteered = vacancy.offers.filter(user=user, status=OvertimeOffer.Status.ACCEPTED).exists()
        offers.hire(vacancy, user, mandatory=not volunteered, by=request.user)
        return self._respond(vacancy)

    @extend_schema(request=None, responses=VacancySerializer)
    @action(detail=True, methods=["post"], url_path="fill-now")
    def fill_now(self, request, pk=None):
        """Stop waiting for answers: hire the top volunteer, or off the list."""
        vacancy = self._open()
        if vacancy.status == Vacancy.Status.UNFILLED:
            vacancy.status = Vacancy.Status.OFFERED
            vacancy.save(update_fields=["status", "updated_at"])
        offers.resolve(vacancy)
        return self._respond(vacancy)

    @extend_schema(request=None, responses=VacancySerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        offers.cancel(self._open())
        return self._respond(self.get_object())


class OvertimeOfferViewSet(TenantViewSet):
    """Overtime offers. Members see and answer their own; officers see everyone's."""

    queryset = OvertimeOffer.objects.select_related("vacancy__filling_for", "vacancy__station", "user")
    serializer_class = OvertimeOfferSerializer
    filterset_fields = ["status", "vacancy"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset().order_by("-id")
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(vacancy__status=Vacancy.Status.OFFERED)
        return queryset if self.request.user.is_officer else queryset.filter(user=self.request.user)

    @extend_schema(
        parameters=[OpenApiParameter("open", OpenApiTypes.BOOL, description="Only offers still taking answers")]
    )
    def list(self, request, *args, **kwargs):
        offers.process_due(request.user.department)
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        raise PermissionDenied("Offers are sent when a vacancy is posted.")

    def _answer(self, accept):
        offer = self.get_object()
        if offer.user_id != self.request.user.id:
            raise PermissionDenied("Only the member offered can answer.")
        offers.process_due(self.request.user.department)
        offer.refresh_from_db()
        # Members can change their answer until volunteering closes.
        closed = (OvertimeOffer.Status.EXPIRED, OvertimeOffer.Status.WITHDRAWN)
        if offer.status in closed or offer.vacancy.status != Vacancy.Status.OFFERED:
            raise ValidationError("This offer has closed.")
        offers.respond(offer, accept)
        offer.refresh_from_db()
        return Response(self.get_serializer(offer).data)

    @extend_schema(request=None, responses=OvertimeOfferSerializer)
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        return self._answer(True)

    @extend_schema(request=None, responses=OvertimeOfferSerializer)
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._answer(False)


class OvertimeListView(APIView):
    """``GET /overtime-list/?date=`` – the rolling mandatory overtime lists, and who is up next that day."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(
        parameters=[OpenApiParameter("date", OpenApiTypes.DATE, required=False)],
        responses=OvertimeBoardSerializer,
    )
    def get(self, request):
        raw = request.query_params.get("date")
        date = parse_date(raw, "date") if raw else timezone.localdate()
        offers.process_due(request.user.department)
        return Response(overtime_list(request.user.department, date))


class StationBoardView(APIView):
    """``GET /station-board/?station=&date=`` – the Today screen: the member's own assignment, and who is
    riding which rig at a station (defaults to where the member works)."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(
        parameters=[
            OpenApiParameter("station", OpenApiTypes.INT, required=False),
            OpenApiParameter("date", OpenApiTypes.DATE, required=False),
        ],
        responses=StationBoardSerializer,
    )
    def get(self, request):
        raw = request.query_params.get("date")
        date = parse_date(raw, "date") if raw else timezone.localdate()
        station = None
        if raw_station := request.query_params.get("station"):
            station = Station.objects.filter(department=request.user.department, pk=_int(raw_station)).first()
            if station is None:
                raise ValidationError({"station": "No such station."})
        return Response(station_board(request.user, date, station))


def _int(value):
    try:
        return int(value)
    except ValueError:
        raise ValidationError({"station": "Must be a station id."}) from None


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
        if leave.user_id == request.user.id:
            raise PermissionDenied("Another officer must review your own leave.")
        if leave.status != LeaveRequest.Status.PENDING:
            raise ValidationError("This request has already been reviewed.")
        review = ReviewSerializer(data=request.data)
        review.is_valid(raise_exception=True)
        leave.status = new_status
        leave.reviewed_by = request.user
        leave.reviewed_at = timezone.now()
        leave.review_note = review.validated_data.get("note", "")
        leave.save()
        if new_status == LeaveRequest.Status.APPROVED:
            offers.vacancies_for_leave(leave, by=request.user)
        return Response(LeaveRequestSerializer(leave, context=self.get_serializer_context()).data)

    @extend_schema(request=ReviewSerializer, responses=LeaveRequestSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer], serializer_class=ReviewSerializer)
    def approve(self, request, pk=None):
        return self._review(request, LeaveRequest.Status.APPROVED)

    @extend_schema(request=ReviewSerializer, responses=LeaveRequestSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer], serializer_class=ReviewSerializer)
    def deny(self, request, pk=None):
        return self._review(request, LeaveRequest.Status.DENIED)

    @extend_schema(responses=StaffingDaySerializer(many=True))
    @action(detail=True, methods=["get"], permission_classes=[IsOfficer], pagination_class=None)
    def impact(self, request, pk=None):
        """Staffing shortfalls approving this leave would cause, by day."""
        leave = self.get_object()
        if (leave.end_date - leave.start_date).days > MAX_OUTLOOK_DAYS:
            return Response([])
        return Response(leave_impact(leave))

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
        offers.cancel_for_leave(leave)
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

    def _not_a_party(self, trade):
        if self.request.user.id in (trade.requester_id, trade.covering_member_id):
            raise PermissionDenied("Another officer must review a trade you're part of.")

    @extend_schema(request=None)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer])
    def approve(self, request, pk=None):
        trade = self.get_object()
        self._not_a_party(trade)
        return self._transition(
            trade, [ShiftTrade.Status.PENDING_APPROVAL], ShiftTrade.Status.APPROVED, reviewer=request.user
        )

    @extend_schema(request=None)
    @action(detail=True, methods=["post"], permission_classes=[IsOfficer])
    def deny(self, request, pk=None):
        trade = self.get_object()
        self._not_a_party(trade)
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
