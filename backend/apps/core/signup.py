"""Self-serve sign-up for a new department, and its onboarding checklist."""

import datetime

from django.contrib.auth import login, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.text import slugify
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import Department, Station, User
from .permissions import IsDepartmentMember
from .serializers import MeSerializer

TIMEZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Puerto_Rico",
]


class SignupThrottle(AnonRateThrottle):
    rate = "5/hour"


class SignupSerializer(serializers.Serializer):
    department_name = serializers.CharField(max_length=200)
    timezone = serializers.ChoiceField(choices=TIMEZONES)
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    username = serializers.RegexField(r"^[\w.@+-]+$", max_length=150)
    password = serializers.CharField(write_only=True)
    starter_kit = serializers.BooleanField(
        default=True, help_text="A/B/C platoons on a 24/48, a sample engine checklist and common certifications"
    )

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    def validate(self, attrs):
        candidate = User(
            username=attrs["username"],
            email=attrs["email"],
            first_name=attrs["first_name"],
            last_name=attrs["last_name"],
        )
        try:
            password_validation.validate_password(attrs["password"], candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs


def unique_slug(name):
    base = slugify(name)[:40] or "department"
    slug, n = base, 2
    while Department.objects.filter(slug=slug).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


def install_starter_kit(department):
    from apps.apparatus.models import ChecklistItem, ChecklistTemplate
    from apps.certifications.models import CertificationType
    from apps.scheduling.models import Platoon, RotationPattern

    for code, color in (("A", "#c62828"), ("B", "#1565c0"), ("C", "#2e7d32")):
        Platoon.objects.create(department=department, code=code, name=f"{code} Shift", color=color)
    RotationPattern.objects.create(
        department=department,
        name="24/48",
        anchor_date=timezone.localdate(),
        sequence=["A", "B", "C"],
        shift_start=datetime.time(7, 0),
        shift_hours=24,
    )
    template = ChecklistTemplate.objects.create(
        department=department, name="Engine daily check", apparatus_type="engine"
    )
    items = {
        "Cab": ["Fuel 3/4 or more", "Radios and MDT working"],
        "Exterior": ["Lights, emergency lights and siren", "Tires and lug nuts"],
        "Pump": ["Engage pump, check pressure", "Tank full"],
        "Equipment": ["SCBA bottles full", "Thermal imager charged"],
    }
    order = 0
    for section, prompts in items.items():
        for prompt in prompts:
            ChecklistItem.objects.create(template=template, section=section, prompt=prompt, order=order)
            order += 1
    for name, code, months, required in (
        ("EMT", "EMT-B", 24, False),
        ("Paramedic", "NRP", 24, False),
        ("CPR / BLS", "", 24, True),
        ("Driver/Operator", "D/O", 36, False),
    ):
        CertificationType.objects.create(
            department=department, name=name, code=code, renewal_months=months, required_for_all=required
        )


@method_decorator(csrf_protect, name="dispatch")
class SignupView(APIView):
    """Create a department and its first admin, and sign them in (session cookie)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [SignupThrottle]

    @extend_schema(request=SignupSerializer, responses={201: MeSerializer})
    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            department = Department.objects.create(
                name=data["department_name"], slug=unique_slug(data["department_name"]), timezone=data["timezone"]
            )
            admin = User(
                department=department,
                role=User.Role.ADMIN,
                username=data["username"],
                email=data["email"],
                first_name=data["first_name"],
                last_name=data["last_name"],
                rank="Chief",
            )
            admin.set_password(data["password"])
            admin.save()
            if data["starter_kit"]:
                install_starter_kit(department)
        login(request, admin, backend="django.contrib.auth.backends.ModelBackend")
        return Response(MeSerializer(admin, context={"request": request}).data, status=status.HTTP_201_CREATED)


StepSchema = inline_serializer(
    "OnboardingStep",
    {
        "key": serializers.CharField(),
        "title": serializers.CharField(),
        "done": serializers.BooleanField(),
        "link": serializers.CharField(help_text="Web app path where it's done"),
    },
    many=True,
)


class OnboardingView(APIView):
    """What a new department still has to set up."""

    permission_classes = [IsDepartmentMember]

    @extend_schema(responses=StepSchema)
    def get(self, request):
        from apps.apparatus.models import Apparatus, ChecklistTemplate
        from apps.inventory.models import StockLevel
        from apps.scheduling.models import Assignment, RotationPattern

        d = request.user.department
        steps = [
            ("stations", "Add your stations", Station.objects.filter(department=d).exists(), "/stations"),
            ("apparatus", "Add your apparatus", Apparatus.objects.filter(department=d).exists(), "/apparatus"),
            ("people", "Add your members", User.objects.filter(department=d).count() > 1, "/people"),
            (
                "rotation",
                "Set up your shift rotation",
                RotationPattern.objects.filter(department=d).exists(),
                "/schedule",
            ),
            (
                "assignments",
                "Assign members to platoons",
                Assignment.objects.filter(department=d).exists(),
                "/schedule",
            ),
            (
                "checklists",
                "Create a rig checklist",
                ChecklistTemplate.objects.filter(department=d).exists(),
                "/checklists",
            ),
            ("inventory", "Stock your supplies", StockLevel.objects.filter(department=d).exists(), "/inventory"),
        ]
        return Response([{"key": k, "title": t, "done": done, "link": link} for k, t, done, link in steps])
