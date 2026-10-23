"""Health check and the web app shell."""

from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.cache import never_cache


@never_cache
def healthz(request):
    """For load balancers and uptime monitors: the app is up and can reach the database."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:  # noqa: BLE001 - any database failure means unhealthy
        return JsonResponse({"status": "error", "database": "unreachable"}, status=503)
    return JsonResponse({"status": "ok"})


@never_cache
def web_app(request, path=""):
    """Serve the web app's index.html for client-side routes like /apparatus/12."""
    index = settings.WEB_DIST / "index.html"
    if not index.exists():
        raise Http404("The web app hasn't been built. Run `npm run build` in web/.")
    return FileResponse(open(index, "rb"), content_type="text/html")
