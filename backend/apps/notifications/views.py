from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, PushDevice
from .serializers import NotificationSerializer, PushDeviceSerializer


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Your own notifications, newest first."""

    serializer_class = NotificationSerializer
    queryset = Notification.objects.all()

    def get_queryset(self):
        return super().get_queryset().filter(user=self.request.user)

    @extend_schema(request=None, responses=NotificationSerializer)
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at", "updated_at"])
        return Response(self.get_serializer(notification).data)

    @extend_schema(request=None, responses={204: None})
    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        self.get_queryset().filter(read_at=None).update(read_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class PushDeviceView(APIView):
    """``POST /push-devices/`` – register this phone for push notifications (the signed-in member's)."""

    @extend_schema(request=PushDeviceSerializer, responses={204: None})
    def post(self, request):
        serializer = PushDeviceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # A phone belongs to whoever signed in on it last.
        PushDevice.objects.update_or_create(
            token=serializer.validated_data["token"],
            defaults={
                "user": request.user,
                "department": request.user.department,
                "platform": serializer.validated_data.get("platform", ""),
            },
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=PushDeviceSerializer, responses={204: None})
    def delete(self, request):
        PushDevice.objects.filter(user=request.user, token=request.data.get("token", "")).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
