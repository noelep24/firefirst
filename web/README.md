# FireFirst web (officers and admins)

The browser app for running the department: fleet, maintenance, inventory,
scheduling, approvals, events and training, people, and the audit log.
Members use the mobile app; the web app turns them away at sign-in.

Built with React 19, Vite, React Router and TanStack Query. Model types are
generated from the backend's OpenAPI schema (`src/api/schema.d.ts`).

## Pages

| Page                | What officers do there                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard           | Rigs out of service, open work orders, maintenance due, low and expiring stock, approvals waiting, the week's events                                                                                                                                                             |
| Apparatus           | Fleet list. Each rig has a page with its work orders (an out-of-service order changes the rig's status), rig-check history with every answer, preventive maintenance due by date, miles or hours (with one-click "Log done"), and service history with costs and pass/fail tests |
| Work orders         | Every repair across the fleet, filterable by status and priority                                                                                                                                                                                                                 |
| Inventory           | Stock by location (filter by below par or expiring), record restocks, use, disposal and counts with notes, item catalog, storage locations on stations or rigs, full activity log                                                                                                |
| Schedule            | Month calendar with the platoon rotation, events and leave; daily roster by station; assignments; platoons and rotation patterns                                                                                                                                                 |
| Approvals           | Pending leave (showing who else is already off) and shift trades, with notes. You can't approve your own requests                                                                                                                                                                |
| Events & training   | Create events, invite members (mandatory events invite everyone), record attendance, training-hour totals by member                                                                                                                                                              |
| Rig checklists      | Build the checklists crews fill out on the mobile app                                                                                                                                                                                                                            |
| People, Stations    | Members, roles and passwords (admins only)                                                                                                                                                                                                                                       |
| Audit log           | Every change: who, when, and before and after values (admins only)                                                                                                                                                                                                               |
| Department settings | Name and time zone (admins only)                                                                                                                                                                                                                                                 |

## Running it

Start the backend first (see the root README). Then:

```bash
cd web
npm install
npm run dev        # http://localhost:5173 (proxies /api to http://localhost:8000)
```

Sign in as `demo-chief` / `firefirst-demo` after `python manage.py seed_demo`.
Set `FIREFIRST_API` to proxy to a different backend.

## How auth works

The web app uses Django's session cookie (httpOnly, so scripts can't read it)
plus CSRF protection. It isn't a JWT in local storage. In development, Vite
proxies `/api` so the cookies are first-party. In production, serve the built
app from the same site as the API.

## Working on it

```bash
npm run typecheck
npm run lint        # oxlint + Prettier
npm test            # Vitest unit tests
npm run build       # production build in dist/
npm run api:types   # regenerate src/api/schema.d.ts after backend API changes
```

Most setup screens use `CrudPage` (`src/components/crud.tsx`): give it an
endpoint, table columns and form fields, and you get search, filters, and
create, edit and delete in a modal with field-level validation errors from
the API.
