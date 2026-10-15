// Sentinel service worker: offline app shell + push notifications.
const VERSION = 'sentinel-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/charts.js', '/fonts/archivo.woff2', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/demo-api/')) return; // live data: never cache
  // fonts: cache-first
  if (url.host.includes('fonts.g')) {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // app shell: network-first so updates land immediately, cache when offline
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Sentinel', body: e.data ? e.data.text() : '' }; }
  const critical = d.severity === 'critical' || d.severity === 'high';
  e.waitUntil(
    self.registration.showNotification(d.title || 'Sentinel alert', {
      body: d.body || '',
      tag: d.tag || 'sentinel',
      renotify: !!d.renotify,
      requireInteraction: critical,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      vibrate: critical ? [200, 100, 200, 100, 400] : [120],
      data: { url: d.url || '/#/alerts' },
      timestamp: Date.now(),
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin)) { c.navigate(target).catch(() => {}); return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});
