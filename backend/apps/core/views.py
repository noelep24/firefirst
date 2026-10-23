from rest_framework import generics

from .models import Station, User
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
