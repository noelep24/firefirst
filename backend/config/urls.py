from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.apparatus import views as apparatus
from apps.core import views as core
from apps.core.dashboard import DashboardView
from apps.events import views as events
from apps.inventory import views as inventory
from apps.scheduling import views as scheduling

router = DefaultRouter()
router.register("stations", core.StationViewSet)
router.register("users", core.UserViewSet)

router.register("inventory/items", inventory.ItemViewSet)
router.register("inventory/locations", inventory.StorageLocationViewSet)
router.register("inventory/stock", inventory.StockLevelViewSet)
router.register("inventory/transactions", inventory.StockTransactionViewSet)

router.register("apparatus", apparatus.ApparatusViewSet)
router.register("checklists", apparatus.ChecklistTemplateViewSet)
router.register("inspections", apparatus.InspectionViewSet)
router.register("work-orders", apparatus.WorkOrderViewSet)
router.register("maintenance-schedules", apparatus.MaintenanceScheduleViewSet)
router.register("service-records", apparatus.ServiceRecordViewSet)

router.register("platoons", scheduling.PlatoonViewSet)
router.register("rotation-patterns", scheduling.RotationPatternViewSet)
router.register("assignments", scheduling.AssignmentViewSet)
router.register("leave-requests", scheduling.LeaveRequestViewSet)
router.register("shift-trades", scheduling.ShiftTradeViewSet)

router.register("events", events.EventViewSet)

api_v1 = [
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", core.MeView.as_view(), name="me"),
    path("department/", core.DepartmentView.as_view(), name="department"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("roster/", scheduling.RosterView.as_view(), name="roster"),
    path("shift-calendar/", scheduling.ShiftCalendarView.as_view(), name="shift-calendar"),
    path("", include(router.urls)),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]
