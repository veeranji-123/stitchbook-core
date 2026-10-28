async function notify(userId, title, body, bookingId) {
  const baseUrl = process.env.NOTIFICATIONS_URL;
  const token = process.env.INTERNAL_TOKEN;
  if (!baseUrl || !token || !userId) return;
  try {
    await fetch(`${baseUrl.replace(/\/$/, '')}/internal/notifications`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
      },
      body: JSON.stringify({ userId, title, body, bookingId: bookingId || '' }),
    });
  } catch (error) {
    console.error('[notify] Failed to send notification:', error.message);
  }
}

module.exports = { notify };
