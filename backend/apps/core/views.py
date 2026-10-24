import base64

from django.http import Http404, HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from .models import Department, Station, User
from .permissions import IsDepartmentAdminOrReadOnly, IsDepartmentMember
from .serializers import DepartmentSerializer, MeSerializer, StationSerializer, UserSerializer
from .tenancy import TenantViewSet


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = MeSerializer
    permission_classes = [IsDepartmentMember]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user


class DepartmentView(generics.RetrieveUpdateAPIView):
    serializer_class = DepartmentSerializer
    permission_classes = [IsDepartmentAdminOrReadOnly]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user.department


@extend_schema(exclude=True)
class DepartmentLogoView(APIView):
    """``GET /departments/<slug>/logo/`` – the department's patch as an image, for ``<img>`` tags.

    Public, like a patch on a door: it carries no member data, and image requests don't send API tokens.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, slug):
        department = Department.objects.filter(slug=slug, is_active=True).exclude(logo="").first()
        if department is None:
            raise Http404
        header, _, data = department.logo.partition(",")
        response = HttpResponse(base64.b64decode(data), content_type=header.removeprefix("data:").split(";")[0])
        response["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


class StationViewSet(TenantViewSet):
    queryset = Station.objects.all()
    serializer_class = StationSerializer
    permission_classes = [IsDepartmentAdminOrReadOnly]
    search_fields = ["number", "name"]


class UserViewSet(TenantViewSet):
    queryset = User.objects.select_related("home_station").order_by("last_name", "first_name")
    serializer_class = UserSerializer
    permission_classes = [IsDepartmentAdminOrReadOnly]
    filterset_fields = ["role", "home_station", "is_active"]
    search_fields = ["username", "first_name", "last_name", "employee_id"]

    def perform_destroy(self, instance):
        # Members are referenced by inspections, logs and schedules, so deactivate rather than delete.
        instance.is_active = False
        instance.save(update_fields=["is_active"])
