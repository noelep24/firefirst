"""Cookie-session login for the officer web app.

The browser keeps an httpOnly session cookie (not readable by page scripts) and
sends the CSRF token from the ``csrftoken`` cookie in an ``X-CSRFToken`` header,
which DRF's SessionAuthentication checks on every unsafe request. The mobile
apps use JWT instead.
"""

from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .serializers import MeSerializer


class LoginThrottle(AnonRateThrottle):
    rate = "10/min"


class CsrfView(APIView):
    """Sets the ``csrftoken`` cookie. Call once before logging in."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={204: None})
    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class SessionView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]

    @extend_schema(
        request=inline_serializer(
            "SessionLoginRequest", {"username": serializers.CharField(), "password": serializers.CharField()}
        ),
        responses={200: MeSerializer, 400: None},
    )
    def post(self, request):
        user = authenticate(
            request, username=request.data.get("username", ""), password=request.data.get("password", "")
        )
        if user is None or not user.department_id:
            return Response({"detail": "Wrong username or password."}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(MeSerializer(user, context={"request": request}).data)

    @extend_schema(responses={204: None})
    def delete(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
