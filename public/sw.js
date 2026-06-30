/**
 * ChatBox Admin — Service Worker
 * Handles Web Push notifications when the browser tab is closed
 */

// Listen for push events from the server
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'ChatBox', body: event.data.text() };
  }

  const title = payload.title || 'Tin nhắn mới';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.ico',
    badge: '/favicon.ico',
    tag: payload.conversationId ? `chatbox-${payload.conversationId}` : 'chatbox-notification',
    data: {
      conversationId: payload.conversationId,
      type: payload.type,
      url: self.registration.scope + 'admin.html',
    },
    // Vibration pattern (mobile)
    vibrate: [200, 100, 200],
    // Keep notification visible until user interacts
    requireInteraction: true,
    // Action buttons
    actions: [
      { action: 'open', title: 'Mở ChatBox' },
      { action: 'dismiss', title: 'Bỏ qua' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // Open or focus the admin page
  const urlToOpen = event.notification.data?.url || '/admin.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if admin page is already open
      for (const client of windowClients) {
        if (client.url.includes('admin.html') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(urlToOpen);
    })
  );
});

// Service worker lifecycle
self.addEventListener('install', (event) => {
  // Skip waiting to activate immediately
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Claim all clients immediately
  event.waitUntil(self.clients.claim());
});
