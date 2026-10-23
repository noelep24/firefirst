import csv
import datetime
import io

from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.params import parse_date
from apps.core.permissions import IsOfficer

from .reports import REPORTS

MAX_RANGE_DAYS = 3 * 366


class ReportListView(APIView):
    permission_classes = [IsOfficer]

    @extend_schema(
        responses=inline_serializer(
            "ReportInfo",
            {
                "slug": serializers.CharField(),
                "title": serializers.CharField(),
                "description": serializers.CharField(),
                "uses_dates": serializers.BooleanField(),
            },
            many=True,
        )
    )
    def get(self, request):
        return Response(
            [
                {"slug": r.slug, "title": r.title, "description": r.description, "uses_dates": r.uses_dates}
                for r in REPORTS.values()
            ]
        )


class ReportView(APIView):
    """A report as JSON, or as CSV with ``?export=csv``. Dates default to the year to date."""

    permission_classes = [IsOfficer]

    @extend_schema(
        parameters=[
            OpenApiParameter("start", OpenApiTypes.DATE),
            OpenApiParameter("end", OpenApiTypes.DATE),
            OpenApiParameter("export", OpenApiTypes.STR, enum=["csv"]),
        ],
        responses=inline_serializer(
            "Report",
            {
                "slug": serializers.CharField(),
                "title": serializers.CharField(),
                "start": serializers.DateField(allow_null=True),
                "end": serializers.DateField(allow_null=True),
                "columns": inline_serializer(
                    "ReportColumn", {"key": serializers.CharField(), "label": serializers.CharField()}, many=True
                ),
                "rows": serializers.ListField(child=serializers.DictField()),
            },
        ),
    )
    def get(self, request, slug):
        try:
            cls = REPORTS[slug]
        except KeyError:
            raise NotFound(f"No report called “{slug}”.") from None
        today = timezone.localdate()
        start = (
            parse_date(request.query_params["start"], "start")
            if request.query_params.get("start")
            else datetime.date(today.year, 1, 1)
        )
        end = parse_date(request.query_params["end"], "end") if request.query_params.get("end") else today
        if end < start or (end - start).days > MAX_RANGE_DAYS:
            raise ValidationError({"end": "End must be after start, within three years."})
        report = cls(request.user.department, start, end).as_dict()

        if request.query_params.get("export") == "csv":
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow([c["label"] for c in report["columns"]])
            for row in report["rows"]:
                writer.writerow(["" if row.get(c["key"]) is None else row[c["key"]] for c in report["columns"]])
            # A BOM so Excel opens UTF-8 (names with accents) correctly.
            response = HttpResponse("﻿" + buffer.getvalue(), content_type="text/csv; charset=utf-8")
            suffix = f"-{start}-to-{end}" if cls.uses_dates else f"-{today}"
            response["Content-Disposition"] = f'attachment; filename="firefirst-{slug}{suffix}.csv"'
            return response
        return Response(report)
