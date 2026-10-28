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

Online payment orders, verification, and Razorpay webhooks live in `stitchbook-payments`. Booking and payment alerts are sent to `stitchbook-notifications` when `NOTIFICATIONS_URL` is set.

## Run

```bash
cp .env.example .env
# set DB_* and JWT_SECRET
npm install
npm start
```

`GET /` returns the service name. `GET /api/health` checks PostgreSQL.
