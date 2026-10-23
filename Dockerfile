# FireFirst: API, admin and officer web app in one image.
#   docker build -t firefirst .
#   docker run -p 8000:8000 --env-file .env firefirst

# ---- Build the web app ----
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Python app ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_DEBUG=false \
    FIREFIRST_WEB_DIST=/app/web/dist
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/web/dist
# collectstatic needs a key at build time only; the real one comes from the environment at runtime.
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput \
    && useradd --create-home --uid 10001 firefirst
USER firefirst
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
# Apply migrations, then serve. (On platforms with a release phase, run `python manage.py migrate` there instead.)
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --access-logfile -"]
