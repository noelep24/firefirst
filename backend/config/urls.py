from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.apparatus import views as apparatus
from apps.audit.views import AuditEntryViewSet
from apps.certifications import views as certifications
from apps.core import views as core
from apps.core.dashboard import DashboardView
from apps.core.session_auth import CsrfView, SessionView
from apps.core.signup import OnboardingView, SignupView
from apps.core.site import healthz, web_app
from apps.events import views as events
from apps.imports import views as imports
from apps.inventory import views as inventory
from apps.reports import views as reports
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
router.register("staffing-rules", scheduling.StaffingRuleViewSet)

router.register("certification-types", certifications.CertificationTypeViewSet)
router.register("certifications", certifications.CertificationViewSet)

router.register("events", events.EventViewSet)
router.register("audit-log", AuditEntryViewSet)

api_v1 = [
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/csrf/", CsrfView.as_view(), name="csrf"),
    path("auth/session/", SessionView.as_view(), name="session"),
    path("signup/", SignupView.as_view(), name="signup"),
    path("onboarding/", OnboardingView.as_view(), name="onboarding"),
    path("me/", core.MeView.as_view(), name="me"),
    path("me/calendar-feed/", events.MyCalendarFeedView.as_view(), name="my-calendar-feed"),
    path("department/", core.DepartmentView.as_view(), name="department"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("roster/", scheduling.RosterView.as_view(), name="roster"),
    path("station-board/", scheduling.StationBoardView.as_view(), name="station-board"),
    path("shift-calendar/", scheduling.ShiftCalendarView.as_view(), name="shift-calendar"),
    path("staffing/", scheduling.StaffingOutlookView.as_view(), name="staffing"),
    path("reports/", reports.ReportListView.as_view(), name="reports"),
    path("reports/<slug:slug>/", reports.ReportView.as_view(), name="report"),
    path("imports/", imports.ImportKindsView.as_view(), name="imports"),
    path("imports/<slug:kind>/", imports.ImportView.as_view(), name="import"),
    path("imports/<slug:kind>/template/", imports.ImportTemplateView.as_view(), name="import-template"),
    path("", include(router.urls)),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
    path("calendar/<str:token>.ics", events.CalendarFeedView.as_view(), name="calendar-feed"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
    path("healthz", healthz, name="healthz"),
    # Everything else is a web app route (files like /assets/*.js are served by WhiteNoise first).
    re_path(r"^(?!api/|admin/|static/|calendar/)(?P<path>.*)$", web_app, name="web-app"),
]
