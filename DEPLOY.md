# Deploying FireFirst

FireFirst ships as **one container**: the Django API, the admin, and the
built officer web app, served from the same site (required for the web app's
secure session cookies). It needs a PostgreSQL database. The mobile apps talk
to the same server.

## Build and run

```bash
docker build -t firefirst .
docker run -p 8000:8000 --env-file .env firefirst
```

The container runs `migrate` on start and then gunicorn. On platforms with a
release phase (Render, Heroku-style, Fly `release_command`), run
`python manage.py migrate` there and override the command with:

```
gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 3
```

The image has a `HEALTHCHECK`; point your load balancer at `GET /healthz`
(returns 200 when the app can reach the database, 503 when it can't).

## Environment

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://user:pass@host:5432/firefirst` | Managed Postgres 16 recommended |
| `DJANGO_SECRET_KEY` | 50+ random characters | Required. The app refuses to start without it when debug is off |
| `DJANGO_DEBUG` | `false` | The image defaults to `false` |
| `DJANGO_ALLOWED_HOSTS` | `app.firefirst.example` | Comma-separated |
| `CSRF_TRUSTED_ORIGINS` | `https://app.firefirst.example` | The public origin of the web app |
| `DJANGO_SECURE_SSL_REDIRECT` | `true` | Keep `true` behind a TLS-terminating proxy (it trusts `X-Forwarded-Proto`) |
| `DJANGO_HSTS_SECONDS` | `2592000` | Raise to a year once you're sure about HTTPS |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Only needed if something other than the native apps or the same-site web app calls the API from a browser |
| `WEB_CONCURRENCY` | `3` | gunicorn workers (about 2 × CPU cores) |
| `PORT` | `8000` | Set by most platforms |
| `PUSH_NOTIFICATIONS_ENABLED` | `true` | Sends phone notifications (overtime offers and the like) through Expo's push service |

With debug off you get HTTPS redirects, HSTS, `nosniff`, `X-Frame-Options:
DENY`, a same-origin referrer policy, secure httpOnly session cookies,
year-long caching for fingerprinted web assets, and logs on stdout.

## Scheduled jobs

Run every 5 minutes:

```bash
python manage.py process_overtime   # closes volunteering on vacancies whose answer time is up, and hires
```

Deadlines are also acted on whenever someone opens the overtime list or their offers, so a missed run only
delays a hire until the next look.

Run daily (cron, a platform scheduler, or a one-off container):

```bash
python manage.py prune_idempotency_keys   # clears stored mobile-retry responses older than 14 days
```

## First run

```bash
python manage.py createsuperuser   # platform staff, for /admin/ (not tied to a department)
```

New departments sign up themselves on the web app ("Create your
department"). To onboard one by hand from spreadsheets:

```bash
python manage.py import_data <department-slug> people people.xlsx            # preview
python manage.py import_data <department-slug> people people.xlsx --commit
```

## Mobile apps

The apps are built in the cloud with EAS, from `mobile/` (project
`@noelep24/firefirst` on expo.dev). `mobile/eas.json` has two profiles:

| Profile | What you get | Needs |
| --- | --- | --- |
| `preview` | An app your crews install directly: an APK on Android, an ad hoc build on iPhone | Apple Developer account for iPhone; each iPhone registered first (`npx eas-cli@latest device:create`) |
| `production` | Store builds for TestFlight and Google Play, build number raised automatically | Apple Developer account ($99/yr), Google Play Console account ($25 once) |

**1. Tell the apps where the server is.** On expo.dev → FireFirst → Environment
variables, add `EXPO_PUBLIC_API_URL` (for example
`https://app.firefirst.example`) to the *preview* and *production*
environments, with visibility "Plain text". It is baked into the app at build
time. Without it the app starts pointed at `localhost` and members have to
type the server address on the sign-in screen (they can always change it
there).

**2. Build.**

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android   # install link + QR code when done
npx eas-cli@latest build --profile production --platform all
```

The first iOS build asks for your Apple ID and creates the certificates and
provisioning profiles for you. The first Android build creates an upload key,
which EAS stores.

**3. Ship to testers.**

```bash
npx eas-cli@latest submit --platform ios       # to TestFlight
npx eas-cli@latest submit --platform android   # to a Google Play track
```

Google Play needs the very first upload done by hand in the Play Console, and
a service account key for `submit` after that (EAS walks you through it).

## Before you sell it

- Backups: enable point-in-time recovery on the managed database, and test
  a restore.
- Uptime monitoring on `/healthz`; error tracking (for example, Sentry) on
  the backend and apps.
- Calendar feed links (`/calendar/<token>.ics`) are bearer secrets. Members
  can replace theirs from the app.
- Every change to department data is in the audit log (Admin → Audit log).
- Deleting a department (Django admin) removes all of its data. Export it
  first if the customer asks for a copy.
