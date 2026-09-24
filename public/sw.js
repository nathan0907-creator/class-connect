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
// The notification server only relays the encrypted message; it is decrypted here, on the device, with the
// class key the app keeps in IndexedDB (same database as the private key, see js/crypto.js).
function classKey(cid, epoch) {
  return new Promise((resolve) => {
    const req = indexedDB.open('classconnect', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('keys', 'readonly').objectStore('keys').get(`class:${cid}:${epoch}`);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Returns a readable preview of the pushed message, or null if this device can't decrypt it. */
async function preview(d) {
  if (!d.ciphertext || !d.cid || !d.epoch) return null;
  try {
    const key = await classKey(d.cid, d.epoch);
    if (!key) return null;
    // Same additional data as js/chat.js: the students' channel keeps the original format.
    const aad = d.channel === 'messages' ? `msg|${d.cid}|${d.epoch}|${d.user_id}` : `msg|${d.cid}|${d.channel}|${d.epoch}|${d.user_id}`;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(d.iv), additionalData: new TextEncoder().encode(aad) }, key, fromB64(d.ciphertext));
    const p = JSON.parse(new TextDecoder().decode(plain));
    if (typeof p.text === 'string' && p.text) return p.text.length > 180 ? p.text.slice(0, 177) + '…' : p.text;
    if (p.t === 'poll' && p.poll) return `📊 ${String(p.poll.q || 'Sondage').slice(0, 120)}`;
    if (p.t === 'sticker') return '🏷️ Sticker';
    if (p.t === 'alert' && p.alert) {
      const label = { absent: '🚫 Prof absent', room: '🔁 Changement de salle', cancel: '❌ Cours annulé' }[p.alert.kind] || '📢 Info';
      return `${label} · ${String(p.alert.subject || '').slice(0, 40)} · ${String(p.alert.date || '').slice(0, 10)}`;
    }
    return p.t === 'audio' ? '🎤 Message vocal' : p.t === 'video' ? '🎬 Vidéo' : p.t === 'gif' ? 'GIF' : p.t === 'image' ? '🖼️ Photo' : null;
  } catch { return null; }
}

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data?.json() || {}; } catch { /* not JSON */ }
  const data = msg.data || msg;
  event.waitUntil((async () => {
    // The open page already shows its own (decrypted) notification.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Class Connect', {
      body: (await preview(data)) || data.body || 'Nouveau message',
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
    // Only pages of this site can be opened from a notification.
    let url = new URL('./', self.registration.scope).href;
    try {
      const u = new URL(event.notification.data?.url || './', self.registration.scope);
      if (u.origin === self.location.origin) url = u.href;
    } catch { /* keep the home page */ }
    return self.clients.openWindow(url);
  })());
});
