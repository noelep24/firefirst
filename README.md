# FireFirst

Station administration for fire departments: inventory, apparatus maintenance,
shift scheduling and the events calendar, all in one place. It is built to
replace ESO's station-side modules.

This repository holds:

- **`backend/`**: the API (Django + Postgres), shared by every client
- **`web/`**: the officer and admin app for the browser (React). See [web/README.md](web/README.md)
- **`mobile/`**: the crew app for iOS and Android (Expo / React Native). See [mobile/README.md](mobile/README.md)

## What's in v0.1

| Module | What it does |
| --- | --- |
| **Departments & people** | Multi-station departments, members with roles (admin / officer / member), rank, home station |
| **Inventory** | Item catalog (EMS, PPE, SCBA, tools…), storage locations on stations *or* rigs, par levels, expiration tracking, and an immutable log of every stock movement |
| **Apparatus** | Fleet records, configurable rig-check checklists, inspections that open work orders automatically for deficient items, work orders that take a rig out of service and put it back, and preventive maintenance due by date, mileage or engine hours (pump tests, ladder tests, oil changes…) |
| **Scheduling** | Platoons, rotation patterns (24/48, 48/96, Kelly, or any custom sequence), standing assignments, a live daily roster, a leave request → approval workflow, and shift trades (requester → covering member → officer) |
| **Events** | Department calendar (training, drills, meetings, public ed, inspections), invitations, mandatory events, RSVPs, attendance and training-hour totals |
| **Reports** | Fleet (check rate, out-of-service days, repair and maintenance cost), inventory usage, training hours, leave taken, maintenance status; CSV export |
| **Dashboard** | One call for the morning view: platoon on duty, rigs out of service, open work orders, maintenance due, low and expiring stock, upcoming events and pending approvals |

## Architecture

```
backend/
  config/            settings, URLs
  apps/core/         Department (tenant), Station, User, tenancy, permissions, dashboard
  apps/inventory/    Item, StorageLocation, StockLevel, StockTransaction
  apps/apparatus/    Apparatus, ChecklistTemplate/Item, Inspection, WorkOrder,
                     MaintenanceSchedule, ServiceRecord
  apps/scheduling/   Platoon, RotationPattern, Assignment, LeaveRequest, ShiftTrade, roster
  apps/events/       Event, Attendance
```

**Multi-tenant from day one.** Every department-owned row carries a
`department` foreign key. `apps/core/tenancy.py` is the single enforcement
point:

- `TenantViewSet` filters every query to the caller's department and stamps
  new rows with it.
- `TenantSerializer` restricts every foreign key in a request body to rows in
  the caller's department, so a department can't attach data to another
  department's records. It fails closed: no department means no choices.

This shared-schema design lets you onboard new departments as customers
without new infrastructure. The tests in `apps/core/tests/test_tenancy.py`
pin this behavior down.

**API-first.** All functionality lives in a versioned REST API (`/api/v1/`),
so the web app and the iOS/Android apps share one backend. Mobile apps
authenticate with JWT (`/api/v1/auth/token/`). The browsable API and Django
admin use sessions. A full OpenAPI 3 schema is served at `/api/schema/`, and
you can generate typed clients for the mobile apps from it.

**Roles**

| Role | Can |
| --- | --- |
| Member | View everything in their department, log rig checks, report work orders, record stock usage, request leave and trades, RSVP |
| Officer | Everything a member can, plus manage apparatus, checklists, inventory catalog, schedules and events; approve leave and trades; record attendance |
| Admin | Everything an officer can, plus manage stations, users and department settings |

## Running locally

Requirements: Python 3.12+, and Postgres 16 (or Docker).

```bash
docker compose up -d db                 # or use a local Postgres
python -m venv .venv && source .venv/bin/activate
cd backend
pip install -r requirements-dev.txt
cp .env.example .env                    # optional; defaults match docker-compose
python manage.py migrate
python manage.py seed_demo              # demo department; login demo-chief / firefirst-demo
python manage.py createsuperuser        # platform admin for /admin/
python manage.py runserver
```

Then open:

- http://localhost:8000/api/docs/ for interactive API docs (Swagger)
- http://localhost:8000/api/v1/ for the browsable API (log in through `/admin/` first)
- http://localhost:8000/admin/ for the Django admin

Run checks:

```bash
cd backend
pytest
ruff check . && ruff format --check .
```

## Key endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/token/` | Get JWT access and refresh tokens |
| `GET /api/v1/me/`, `GET /api/v1/dashboard/` | Current user; morning dashboard |
| `/api/v1/stations/`, `/api/v1/users/` | Department setup |
| `/api/v1/inventory/{items,locations,stock,transactions}/` | Inventory |
| `GET /api/v1/inventory/stock/?below_par=true` | Restock list |
| `GET /api/v1/inventory/stock/expiring/?days=30` | Expiring stock |
| `POST /api/v1/inventory/stock/{id}/adjust/` | Use, restock, dispose of or count stock (logged) |
| `/api/v1/apparatus/`, `GET /api/v1/apparatus/{id}/checklists/` | Fleet; checklists that apply to a rig |
| `/api/v1/checklists/`, `/api/v1/inspections/` | Rig-check forms; completed checks |
| `/api/v1/work-orders/?open=true` | Repairs |
| `/api/v1/maintenance-schedules/due/?days=14` | Preventive maintenance due |
| `/api/v1/service-records/` | Maintenance performed (resets its schedule) |
| `GET /api/v1/roster/?date=YYYY-MM-DD` | Who's working, on leave or traded off |
| `GET /api/v1/shift-calendar/?start=&end=` | Platoon on duty per day |
| `/api/v1/leave-requests/` and `…/{id}/approve|deny|cancel/` | Leave |
| `/api/v1/shift-trades/` and `…/{id}/accept|decline|approve|deny|cancel/` | Shift trades |
| `/api/v1/events/?start=&end=`, `…/{id}/rsvp/`, `…/{id}/attendance/` | Calendar |
| `GET /api/v1/events/training-hours/` | Training-hour totals per member |

## Roadmap

**Next: clients**
- [x] Web app for officers and admins (React + TypeScript, types generated from the OpenAPI schema)
- [x] Mobile app (Expo for iOS and Android): rig checks, work orders, stock usage with barcode scanning, roster, leave and trades, calendar
- [x] Mobile offline mode: cached data, an outbox that syncs rig checks, stock changes and problem reports, and idempotent retries
- [ ] Mobile: photos, date picker, store builds (EAS)
- [ ] Push notifications (trade requests, approvals, work orders, maintenance due)

**Replacing ESO**
- [x] CSV/Excel importers for ESO exports and spreadsheets (people, apparatus, inventory) with preview; web page and `manage.py import_data`
- [ ] Importers for schedules and maintenance history
- [ ] Parallel-run period and data reconciliation checklist

**Module depth**
- [ ] Inventory: lot-level expiration, transfers between locations, purchase orders and vendors, controlled-substance logs with dual sign-off
- [ ] Apparatus: photo attachments on inspections and work orders, parts used, cost reports, SCBA and hose testing records
- [x] Minimum-staffing rules (by station, position or certification) with shortfall warnings on the roster, calendar and leave approvals
- [ ] Scheduling: overtime callback lists and hiring, Kelly-day automation, leave balances and accruals, payroll export
- [x] Certification tracking with expirations, renewal periods, required-for-all types and a compliance view
- [ ] Events: recurring events, iCal feeds, ISO training reports

**Selling to other departments**
- [ ] Self-serve department sign-up and onboarding
- [ ] Subscription billing (e.g. Stripe), plans and limits
- [x] Audit log of who changed what
- [ ] SSO (Azure AD and Google Workspace are common in municipal IT), MFA
- [ ] Per-department data export, backups, and a published security and data-retention policy (city IT and procurement will send security questionnaires)
- [ ] Production deployment (container, managed Postgres, object storage for attachments, error monitoring)
