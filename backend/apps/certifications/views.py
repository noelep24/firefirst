from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.models import User
from apps.core.permissions import IsDepartmentMember, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet

from .models import Certification, CertificationType
from .serializers import CertificationSerializer, CertificationTypeSerializer, ComplianceSerializer


class CertificationTypeViewSet(TenantViewSet):
    queryset = CertificationType.objects.all()
    serializer_class = CertificationTypeSerializer
    permission_classes = [IsOfficerOrReadOnly]
    search_fields = ["name", "code"]


class CertificationViewSet(TenantViewSet):
    """Officers manage everyone's certifications; members see their own."""

    queryset = Certification.objects.select_related("user", "certification_type")
    serializer_class = CertificationSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["user", "certification_type"]
    search_fields = ["user__first_name", "user__last_name", "certification_type__name", "number"]

    def get_queryset(self):
        qs = super().get_queryset()
        if not self.request.user.is_officer:
            qs = qs.filter(user=self.request.user)
        return qs

    @extend_schema(responses=ComplianceSerializer(many=True))
    @action(detail=False, methods=["get"], permission_classes=[IsDepartmentMember], pagination_class=None)
    def compliance(self, request):
        """Members with certifications that are expiring, expired, or required but missing."""
        today = timezone.localdate()
        department = request.user.department
        people = User.objects.filter(department=department, is_active=True).order_by("last_name", "first_name")
        if not request.user.is_officer:
            people = people.filter(id=request.user.id)
        required = list(CertificationType.objects.filter(department=department, required_for_all=True))
        held = {}
        for cert in Certification.objects.filter(department=department, user__in=people).select_related(
            "certification_type"
        ):
            # Keep the latest expiration per type: a renewed card replaces the old one.
            key = (cert.user_id, cert.certification_type_id)
            current = held.get(key)
            if current is None or (
                current.expires_on is not None and (cert.expires_on is None or cert.expires_on > current.expires_on)
            ):
                held[key] = cert

        rows = []
        for person in people:
            problems = []
            for cert in [c for (uid, _), c in held.items() if uid == person.id]:
                status = cert.status_on(today)
                if status != Certification.Status.VALID:
                    problems.append(
                        {
                            "certification_type": cert.certification_type_id,
                            "type_name": cert.certification_type.name,
                            "status": status,
                            "expires_on": cert.expires_on,
                        }
                    )
            for cert_type in required:
                if (person.id, cert_type.id) not in held:
                    problems.append(
                        {
                            "certification_type": cert_type.id,
                            "type_name": cert_type.name,
                            "status": "missing",
                            "expires_on": None,
                        }
                    )
            if problems:
                rows.append({"user": person.id, "name": str(person), "problems": problems})
        return Response(rows)
