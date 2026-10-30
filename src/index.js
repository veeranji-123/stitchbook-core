const express = require('express');
const cors = require('cors');
const { port, corsOrigin } = require('./config');
const { initDb } = require('./db');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const tailorRoutes = require('./routes/tailors');
const ratingRoutes = require('./routes/ratings');
const slotRoutes = require('./routes/slots');
const bookingRoutes = require('./routes/bookings');
const shopCatalogRoutes = require('./routes/shopCatalog');
const shopScheduleRoutes = require('./routes/shopSchedule');
const analyticsRoutes = require('./routes/analytics');
const { userRouter, profileRouter, bookingRouter } = require('./routes/measurements');
const favoriteRoutes = require('./routes/favorites');
const internalRoutes = require('./routes/internal');

const app = express();

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use(healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tailors', tailorRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/user', userRouter);
app.use('/api/user', favoriteRoutes);
app.use('/api/measurements', profileRouter);
app.use('/api/bookings', bookingRouter);
app.use('/api/bookings', bookingRoutes);
app.use('/api/tailor', shopCatalogRoutes);
app.use('/api/tailor', shopScheduleRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/internal', internalRoutes);

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`stitchbook-core listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error('[fatal] Database setup failed:', error.message);
    process.exit(1);
  });
