import csv
import io

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsDepartmentAdmin

from .engine import ImportFileError
from .importers import IMPORTERS


def importer_for(kind):
    try:
        return IMPORTERS[kind]
    except KeyError:
        raise NotFound(f"No importer called “{kind}”.") from None


ColumnSchema = inline_serializer(
    "ImportColumn",
    {
        "key": serializers.CharField(),
        "label": serializers.CharField(),
        "required": serializers.BooleanField(),
        "help": serializers.CharField(),
        "aliases": serializers.ListField(child=serializers.CharField()),
    },
)

ReportSchema = inline_serializer(
    "ImportReport",
    {
        "kind": serializers.CharField(),
        "recognized": serializers.DictField(child=serializers.CharField(), help_text="File header -> column"),
        "ignored": serializers.ListField(child=serializers.CharField()),
        "missing": serializers.ListField(child=serializers.CharField()),
        "summary": serializers.DictField(child=serializers.IntegerField()),
        "committed": serializers.BooleanField(),
        "rows": inline_serializer(
            "ImportRow",
            {
                "line": serializers.IntegerField(),
                "action": serializers.ChoiceField(choices=["create", "update", "skip", "error"]),
                "label": serializers.CharField(),
                "errors": serializers.ListField(child=serializers.CharField()),
                "notes": serializers.ListField(child=serializers.CharField()),
            },
            many=True,
        ),
    },
)


class ImportKindsView(APIView):
    """The available importers and the columns each understands."""

    permission_classes = [IsDepartmentAdmin]

    @extend_schema(
        responses=inline_serializer(
            "ImportKind",
            {
                "kind": serializers.CharField(),
                "title": serializers.CharField(),
                "description": serializers.CharField(),
                "columns": ColumnSchema.__class__(many=True),
            },
            many=True,
        )
    )
    def get(self, request):
        return Response(
            [
                {
                    "kind": cls.kind,
                    "title": cls.title,
                    "description": cls.description,
                    "columns": [
                        {
                            "key": c.key,
                            "label": c.label,
                            "required": c.required,
                            "help": c.help,
                            "aliases": list(c.aliases),
                        }
                        for c in cls.columns
                    ],
                }
                for cls in IMPORTERS.values()
            ]
        )


class ImportView(APIView):
    """Upload a CSV or XLSX. Without ``commit`` this only previews; with it, valid rows are saved."""

    permission_classes = [IsDepartmentAdmin]
    parser_classes = [MultiPartParser]

    @extend_schema(
        request={
            "multipart/form-data": inline_serializer(
                "ImportUpload",
                {
                    "file": serializers.FileField(),
                    "commit": serializers.BooleanField(required=False, default=False),
                    "skip_errors": serializers.BooleanField(
                        required=False, default=False, help_text="Save the valid rows even if some have errors"
                    ),
                },
            )
        },
        responses=ReportSchema,
    )
    def post(self, request, kind):
        cls = importer_for(kind)
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"file": ["Choose a file to upload."]}, status=status.HTTP_400_BAD_REQUEST)
        truthy = ("1", "true", "yes", "on")
        commit = str(request.data.get("commit", "")).lower() in truthy
        skip_errors = str(request.data.get("skip_errors", "")).lower() in truthy
        try:
            report = cls(request.user.department, request.user).run(upload, commit=commit, skip_errors=skip_errors)
        except ImportFileError as exc:
            return Response({"file": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(report)


class ImportTemplateView(APIView):
    """A CSV with the expected headers and an example row."""

    permission_classes = [IsDepartmentAdmin]

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    def get(self, request, kind):
        cls = importer_for(kind)
        buffer = io.StringIO()
        csv.writer(buffer).writerows(cls(request.user.department, request.user).template_rows())
        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="firefirst-{kind}-template.csv"'
        return response
