from datetime import timedelta

from django.db.models import F
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.apparatus.models import Apparatus, MaintenanceSchedule, WorkOrder
from apps.events.models import Event
from apps.inventory.models import StockLevel
from apps.scheduling.models import LeaveRequest, ShiftTrade
from apps.scheduling.roster import platoon_on

from .permissions import IsDepartmentMember
from .serializers import DashboardSerializer


class DashboardView(APIView):
    """The station-officer morning view: what needs attention today."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(responses=DashboardSerializer)
    def get(self, request):
        department = request.user.department
        today = timezone.localdate()
        now = timezone.now()

        schedules = MaintenanceSchedule.objects.filter(department=department).select_related("apparatus")
        stock = StockLevel.objects.filter(department=department)
        data = {
            "date": today,
            "platoon_on_duty": platoon_on(department, today),
            "apparatus_out_of_service": list(
                Apparatus.objects.filter(department=department, status=Apparatus.Status.OUT_OF_SERVICE).values(
                    "id", "unit_number"
                )
            ),
            "open_work_orders": WorkOrder.objects.filter(
                department=department, status__in=WorkOrder.OPEN_STATUSES
            ).count(),
            "maintenance_due": sum(1 for s in schedules if s.is_due(warning_days=14)),
            "stock_below_par": stock.filter(quantity__lt=F("par_level")).count(),
            "stock_expiring_30_days": stock.filter(quantity__gt=0, expires_on__lte=today + timedelta(days=30)).count(),
            "upcoming_events": list(
                Event.objects.filter(department=department, ends_at__gte=now, starts_at__lte=now + timedelta(days=7))
                .order_by("starts_at")
                .values("id", "title", "category", "starts_at", "is_mandatory")[:10]
            ),
        }
        if request.user.is_officer:
            data["pending_leave_requests"] = LeaveRequest.objects.filter(
                department=department, status=LeaveRequest.Status.PENDING
            ).count()
            data["pending_shift_trades"] = ShiftTrade.objects.filter(
                department=department, status=ShiftTrade.Status.PENDING_APPROVAL
            ).count()
        return Response(data)
