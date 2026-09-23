// Service worker: offline mode (app shell cache) and push notifications (sent by the "pushOnMessage" Cloud Function).
// VERSION and PRECACHE are filled in by scripts/cache-bust.mjs at deploy time.
const VERSION = 'dev';
const PRECACHE = [];
const SHELL = `cc-shell-${VERSION}`;
const CDN = 'cc-cdn-v1';
const CDN_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const cdn = await caches.open(CDN);
    // One failing file must not prevent the others from being cached.
    await Promise.all(PRECACHE.map((url) => (url.startsWith('https://')
      ? cdn.match(url).then((hit) => hit || cdn.add(new Request(url, { mode: 'cors' })))
      : shell.add(url)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('cc-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages and the site's own files: network first (always up to date), cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req) || await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return (await caches.match('./')) || (await caches.match('index.html', { ignoreSearch: true })) || Response.error();
        return Response.error();
      }
    })());
    return;
  }

  // Versioned libraries (Firebase SDK, three.js, KaTeX, fonts): cache first.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
  // Everything else (Firestore, Auth, Gemini, GIPHY…) goes straight to the network.
});

// ------------------------------------------------------------ push notifications
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data?.json() || {}; } catch { /* not JSON */ }
  const data = msg.data || msg;
  event.waitUntil((async () => {
    // The open page already shows its own (decrypted) notification.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Class Connect', {
      body: data.body || 'Nouveau message',
      tag: data.tag || 'cc',
      renotify: true,
      icon: 'img/icon-192.png',
      badge: 'img/icon-192.png',
      data: { url: data.url || './' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (win) return win.focus();
    return self.clients.openWindow(event.notification.data?.url || './');
  })());
});
