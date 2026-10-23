# FireFirst mobile

The crew-facing app for iOS and Android, built with Expo (SDK 58), Expo Router,
TanStack Query, and a TypeScript client generated from the backend's OpenAPI
schema.

## What it does

| Tab          | For crews                                                                                                                                                  | For officers                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Today**    | Platoon on duty, rigs out of service, open work orders, maintenance due, low and expiring stock, the week's events                                         | Plus pending leave and trade approvals |
| **Rigs**     | Run a rig check (OK / Problem / N/A per item, with readings). Each problem opens a work order automatically. Report a problem, update or close work orders | Same                                   |
| **Supplies** | Search or **scan a barcode**, filter by below par or expiring, and record use, restocks, disposal or a count. Every change is logged with who did it       | Same                                   |
| **Schedule** | Daily roster by station (with leave and trades applied), request leave, request a shift trade, accept or decline trades                                    | Approve or deny leave and trades       |
| **Calendar** | Platoon rotation strip, upcoming events, RSVP                                                                                                              | Same                                   |

Signing in uses JWT. Tokens are stored in the iOS Keychain or Android
Keystore (`expo-secure-store`) and refresh automatically. You can change the
server address on the login screen, which helps when testing against a laptop
on your Wi-Fi.

## Offline

Apparatus bays and rural calls often have no signal, so the app keeps
working without it:

- **Data stays on the phone.** Rigs, every active checklist, supplies and the
  dashboard are cached on the device (for up to 24 hours), so screens open
  with the last-known data. Sections that were never loaded say "No signal"
  instead of spinning.
- **Writes queue in an outbox.** Rig checks, supply changes and problem
  reports made offline are saved on the phone. A banner on every tab shows
  how many are waiting, and they send automatically when signal returns,
  when the app opens, and every 30 seconds while any are waiting.
- **Retries never duplicate.** Each queued write carries an
  `Idempotency-Key`. If the server saved it but the reply was lost, the retry
  gets the original response back instead of saving a second rig check.
- **Rejected writes wait for a person.** If the server refuses one (for
  example, a deficient item without a note), it's marked "Not saved" on the
  Waiting to sync screen, where the member can retry or discard it.
- Queued writes are tied to the member who made them and are only ever sent
  with that member's sign-in.

The outbox logic lives in `src/offline/outbox-core.ts` and is unit-tested
(`npm test`).

## Running it

Start the backend first (see the root README) and load the demo data with
`python manage.py seed_demo`. Then:

```bash
cd mobile
npm install
npx expo start
```

Then scan the QR code with Expo Go on a phone, press `i` for the iOS
simulator or `a` for the Android emulator, or `w` for a browser. Everything,
barcode scanner included, runs in Expo Go.

**Quickest way onto a phone:** `python3 trial.py` from the repository root
does all of this (backend, demo data, server address) in one step. See
[TRIAL.md](../TRIAL.md).

**Server address.** It defaults to `http://localhost:8000`, or
`http://10.0.2.2:8000` on the Android emulator. To use a phone on your network,
run Django with `python manage.py runserver 0.0.0.0:8000`, add your laptop's IP
to `DJANGO_ALLOWED_HOSTS`, and enter `http://<laptop-ip>:8000` under "Server"
on the login screen. You can also set `EXPO_PUBLIC_API_URL` to change the
default.

**Demo logins** (password `firefirst-demo`):

- `demo-chief`: department admin
- `demo-a1-captain`: officer on A shift, Station 1
- `demo-a1-firefighter` or `demo-b1-firefighter`: members (use these two to try a shift trade)

## Working on it

```bash
npm run typecheck     # tsc
npm run lint          # ESLint + Prettier check
npm run format        # Prettier write
npm run api:types     # regenerate src/api/schema.d.ts from ../backend/openapi.yml
```

**When the API changes:**

1. Run `python manage.py spectacular --file openapi.yml` in `backend/`.
2. Run `npm run api:types` here.
3. Fix any type errors the change reveals.

CI fails if either generated file is out of date.

### Layout

```
src/
  app/                 screens (Expo Router: every file is a route)
    (tabs)/            Today, Rigs, Supplies, Schedule, Calendar
    rig/[id]/          rig detail and rig check
    work-order/, stock/, event/, leave/, trade/, scan.tsx, login.tsx
  api/client.ts        typed API client, token storage and refresh, error handling
  api/schema.d.ts      generated; do not edit
  auth/                sign-in state and the useMe() hook
  components/ui.tsx    shared UI (Screen, Card, Button, Field, QueryState, …)
  lib/                 date formatting, labels, secure storage
```

`QueryState` passes the loaded data into its children (`{(data) => …}`). Don't
read `query.data!` inside those closures: React Compiler (enabled in
`app.json`) hoists such reads into render, where they crash before the data
loads.

## Not built yet

- Offline leave requests and RSVPs (they need a live answer today)
- Push notifications for trade requests, approvals and new work orders
- Photos on rig checks and work orders
- Date picker (leave dates are typed as YYYY-MM-DD for now)
- App icons and splash artwork (Expo placeholders for now)
- EAS build profiles and store submission
