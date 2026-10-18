// mytime — service worker: shows push notifications (phone tone + vibration) when the app is closed
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const IOS = /iphone|ipad|ipod|macintosh/i.test(self.navigator.userAgent || '');

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // if the app is open on screen it already alerted the user — skip (iPhone must always show)
    if (!IOS) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some(w => w.visibilityState === 'visible')) return;
    }
    await self.registration.showNotification(d.title || 'mytime', {
      body: d.body || 'You have something new on mytime',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      vibrate: [200, 100, 200],
      data: { url: d.url || './' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) { await wins[0].focus(); return; }
    await self.clients.openWindow(url);
  })());
});
