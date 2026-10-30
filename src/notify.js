async function postInternal(path, body) {
  const baseUrl = process.env.NOTIFICATIONS_URL;
  const token = process.env.INTERNAL_TOKEN;
  if (!baseUrl || !token) return;
  try {
    await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[notify] Failed to reach notifications:', error.message);
  }
}

async function notify(userId, title, body, bookingId) {
  if (!userId) return;
  await postInternal('/internal/notifications', { userId, title, body, bookingId: bookingId || '' });
}

function emit(userId, event, payload) {
  if (!userId) return;
  postInternal('/internal/realtime', { userId, event, payload });
}

notify.emit = emit;

module.exports = { notify, emit };
