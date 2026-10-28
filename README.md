# stitchbook-core

Backend service for StitchBook accounts, shops, ratings, and slots.

The Flutter app and `backend/server.js` in `stitchbook_app` stay as they are. This service is the new backend. It listens on port **3001**.

## Owns

- Customer and tailor registration and login
- Shop list and shop details (`tailor` and `iron` shops together)
- Ratings and appointment slots
- PostgreSQL tables for users, shops, bookings, measurements, and messages

## Stays in other repositories

- Payments: `stitchbook-payments`
- Notifications: `stitchbook-notifications`
- Super admin: `stitchbook-admin`
- Public entry point: `stitchbook-gateway`

Booking create and status updates are the next routes to move into this service. Payment capture stays in `stitchbook-payments`.

## Run

```bash
cp .env.example .env
# set DB_* and JWT_SECRET
npm install
npm start
```

`GET /` returns the service name. `GET /api/health` checks PostgreSQL.
