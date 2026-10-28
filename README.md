# stitchbook-core

Backend service for StitchBook accounts, shops, bookings, ratings, and slots.

The Flutter app and `backend/server.js` in `stitchbook_app` stay as they are. This service is the new backend. It listens on port **3001**.

## Owns

- Customer and tailor registration and login
- Shop list and shop details (`tailor` and `iron` shops together)
- Booking create, status, notes, and tailor payment-status updates
- Ratings and appointment slots
- PostgreSQL tables for users, shops, bookings, measurements, and messages

## Stays in other repositories

- Payments: `stitchbook-payments`
- Notifications: `stitchbook-notifications`
- Super admin: `stitchbook-admin`
- Public entry point: `stitchbook-gateway`

Online payment capture stays in `stitchbook-payments`. Booking notifications stay in `stitchbook-notifications`.

## Run

```bash
cp .env.example .env
# set DB_* and JWT_SECRET
npm install
npm start
```

`GET /` returns the service name. `GET /api/health` checks PostgreSQL.
