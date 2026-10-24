from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsDepartmentAdmin

from .kinds import BY_KEY, KINDS
from .models import Notification, NotificationOptOut, NotificationRule, PushDevice
from .send import channels
from .serializers import ChannelRuleSerializer, MyChannelSerializer, NotificationSerializer, PushDeviceSerializer


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


def _known(rows):
    for row in rows:
        if row["kind"] not in BY_KEY:
            raise ValidationError({"kind": f"Unknown notification: {row['kind']}"})
    return rows


class NotificationRulesView(APIView):
    """``/notification-rules/`` – how the department sends each kind of notification (admins)."""

    permission_classes = [IsDepartmentAdmin]

    def _rules(self, department):
        return [
            {
                "kind": k.key,
                "label": k.label,
                "audience": k.audience,
                "required": k.required,
                **dict(zip(("push", "email"), channels(department, k.key), strict=True)),
            }
            for k in KINDS
        ]

    @extend_schema(responses=ChannelRuleSerializer(many=True))
    def get(self, request):
        return Response(self._rules(request.user.department))

    @extend_schema(request=ChannelRuleSerializer(many=True), responses=ChannelRuleSerializer(many=True))
    def patch(self, request):
        body = ChannelRuleSerializer(data=request.data, many=True)
        body.is_valid(raise_exception=True)
        department = request.user.department
        for row in _known(body.validated_data):
            NotificationRule.objects.update_or_create(
                department=department, kind=row["kind"], defaults={"push": row["push"], "email": row["email"]}
            )
        return Response(self._rules(department))


class MyNotificationsView(APIView):
    """``/me/notifications/`` – which notifications the signed-in member gets on their phone and by email."""

    def _mine(self, user):
        opted_out = {o.kind: o for o in NotificationOptOut.objects.filter(user=user)}
        rows = []
        for k in KINDS:
            if k.officers_only and not user.is_officer:
                continue
            push, email = channels(user.department, k.key)
            out = opted_out.get(k.key)
            rows.append(
                {
                    "kind": k.key,
                    "label": k.label,
                    "required": k.required,
                    "department_push": push,
                    "department_email": email,
                    "push": k.required or not (out and out.push),
                    "email": k.required or not (out and out.email),
                }
            )
        return rows

    @extend_schema(responses=MyChannelSerializer(many=True))
    def get(self, request):
        return Response(self._mine(request.user))

    @extend_schema(request=MyChannelSerializer(many=True), responses=MyChannelSerializer(many=True))
    def patch(self, request):
        body = MyChannelSerializer(data=request.data, many=True)
        body.is_valid(raise_exception=True)
        user = request.user
        for row in _known(body.validated_data):
            if BY_KEY[row["kind"]].required:
                continue  # Required notices always reach the member.
            NotificationOptOut.objects.update_or_create(
                user=user,
                kind=row["kind"],
                defaults={"department": user.department, "push": not row["push"], "email": not row["email"]},
            )
        return Response(self._mine(user))
