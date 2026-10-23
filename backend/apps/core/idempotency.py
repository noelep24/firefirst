"""Safe retries for POST requests from the mobile app's offline outbox.

The app sends ``Idempotency-Key: <uuid>`` with each queued write. The first
request with a key runs normally and its successful response is stored; any
later request with the same key (a retry after a dropped connection) gets the
stored response back instead of creating a second rig check or stock change.

Only JWT-authenticated POSTs to the API participate. Failed requests (non-2xx)
aren't stored, so the client can fix the problem and retry with the same key.
"""

import json

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import IdempotencyKey

HEADER = "Idempotency-Key"


def _jwt_user(request):
    try:
        result = JWTAuthentication().authenticate(request)
    except AuthenticationFailed:
        return None
    return result[0] if result else None


class IdempotencyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        key = request.headers.get(HEADER)
        if request.method != "POST" or not key or not request.path.startswith("/api/"):
            return self.get_response(request)
        if len(key) > 100:
            return JsonResponse({"detail": f"{HEADER} is too long."}, status=400)
        user = _jwt_user(request)
        if user is None:
            return self.get_response(request)  # Let the view reject it as usual.

        try:
            with transaction.atomic():
                record = IdempotencyKey.objects.create(user=user, key=key, path=request.path)
        except IntegrityError:
            return self._replay(user, key, request.path)

        response = self.get_response(request)
        if 200 <= response.status_code < 300 and "json" in response.get("Content-Type", ""):
            record.status_code = response.status_code
            record.body = json.loads(response.content or b"null")
            record.save(update_fields=["status_code", "body"])
        else:
            record.delete()
        return response

    def _replay(self, user, key, path):
        record = IdempotencyKey.objects.get(user=user, key=key)
        if record.path != path:
            return JsonResponse({"detail": f"This {HEADER} was already used for a different request."}, status=422)
        if record.status_code is None:
            return JsonResponse({"detail": "The original request is still being processed. Try again."}, status=409)
        response = JsonResponse(record.body, status=record.status_code, safe=False)
        response["Idempotent-Replayed"] = "true"
        return response
