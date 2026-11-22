'use strict';

// Desktop notification buttons submit the same authenticated vote as the game UI.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { code, id, deadline } = event.notification.data || {};
  if (!/^[A-Z2-9]{4}$/.test(code) || !Number.isInteger(id)) return;
  event.waitUntil((async () => {
    if (['agree', 'reject'].includes(event.action) && Date.now() < deadline) {
      try {
        const response = await fetch(`/api/rooms/${code}/pause`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'vote', id, agree: event.action === 'agree' }),
        });
        if (response.ok) return;
      } catch { /* Open the game if the vote could not be submitted. */ }
    }
    const url = new URL(`/#${code}`, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url === url);
    if (existing) await existing.focus();
    else await self.clients.openWindow(url);
  })());
});
