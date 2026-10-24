from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsDepartmentAdmin, IsOfficer

from .scheduled import BY_KEY, REPORTS, schedule_for, send
from .serializers import ReportPreviewSerializer, ReportScheduleSerializer


def _row(schedule):
    report = BY_KEY[schedule.report]
    return {
        "report": report.key,
        "label": report.label,
        "description": report.description,
        "weekly": report.weekly,
        "enabled": schedule.enabled,
        "send_at": schedule.send_at,
        "weekday": schedule.weekday,
        "audience": schedule.audience,
        "extra_emails": schedule.extra_emails,
        "last_sent_on": schedule.last_sent_on,
    }


def _schedule(request, key):
    if key not in BY_KEY:
        raise NotFound("No such report.")
    return schedule_for(request.user.department, key)


class ReportSchedulesView(APIView):
    """``/report-schedules/`` – which reports are emailed, when, and to whom (admins)."""

    permission_classes = [IsDepartmentAdmin]

    def _all(self, department):
        return [_row(schedule_for(department, r.key)) for r in REPORTS]

    @extend_schema(responses=ReportScheduleSerializer(many=True))
    def get(self, request):
        return Response(ReportScheduleSerializer(self._all(request.user.department), many=True).data)

    @extend_schema(request=ReportScheduleSerializer(many=True), responses=ReportScheduleSerializer(many=True))
    def patch(self, request):
        body = ReportScheduleSerializer(data=request.data, many=True)
        body.is_valid(raise_exception=True)
        for row in body.validated_data:
            schedule = _schedule(request, row["report"])
            for field in ("enabled", "send_at", "weekday", "audience", "extra_emails"):
                setattr(schedule, field, row[field])
            schedule.save()
        return Response(ReportScheduleSerializer(self._all(request.user.department), many=True).data)


class ReportPreviewView(APIView):
    """``GET /report-schedules/<report>/preview/`` – today's report, as it would be emailed."""

    permission_classes = [IsOfficer]

    @extend_schema(responses=ReportPreviewSerializer)
    def get(self, request, report):
        schedule = _schedule(request, report)
        subject, body = BY_KEY[report].build(schedule.department, timezone.localdate())
        return Response({"subject": subject, "body": body})


class ReportTestSendView(APIView):
    """``POST /report-schedules/<report>/send-test/`` – email today's report to yourself."""

    permission_classes = [IsDepartmentAdmin]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, report):
        if not request.user.email:
            raise ValidationError("Add an email address to your profile first.")
        send(_schedule(request, report), timezone.localdate(), to=[request.user.email])
        return Response(status=status.HTTP_204_NO_CONTENT)
