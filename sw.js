// Caches the app shell so the page opens offline, and receives the Web Push
// alerts the WeatherFitMe service sends, which is what lets them arrive with the
// app closed (Android, and iPhone with the app on the Home Screen).
//
// Forecast data is deliberately NOT cached here — it is kept in localStorage
// with a timestamp so the UI can say how stale it is. A silently cached API
// response would show old weather as though it were current.

const CACHE = 'weatherfit-shell-v5';
// The alerts service: the same site, or the one the page named when it
// registered this worker (a GitHub Pages copy talks to a separate service).
const API = new URL(self.location.href).searchParams.get('api') || '';
const api = (path) => (API ? `${API}/api/push/${path}` : new URL(`./api/push/${path}`, self.registration.scope).href);
// relative to this file, so the same worker runs at a site root or in a sub-folder
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // a page asking for the site itself, past every cache, to see if a newer version is out
  if (request.cache === 'no-store') return;

  const url = new URL(request.url);
  // Never serve a cached forecast, geocode result or service response; and
  // leave other sites' files, such as the globe's map tiles, to the browser.
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('./index.html', self.registration.scope).href)));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    }).catch(() => hit)),
  );
});

// Every push must show a notification: iOS revokes the subscription of a web
// app that receives a push and shows nothing.
self.addEventListener('push', (event) => {
  let note = { title: 'WeatherFitMe', body: 'The forecast has changed.', tag: 'weatherfit', url: self.registration.scope };
  try { note = { ...note, ...event.data.json() }; } catch { if (event.data) note.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(note.title, {
    body: note.body,
    tag: note.tag,
    renotify: true,
    icon: new URL('./icon-192.png', self.registration.scope).href,
    badge: new URL('./badge-96.png', self.registration.scope).href,
    // links are relative to the app, so they open inside it wherever it lives
    data: { url: new URL(note.url || './', self.registration.scope).href },
  }));
});

// When the browser rotates a subscription, move the server's record with it.
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  event.waitUntil((async () => {
    const options = old?.options ?? (await fetch(api('key')).then((r) => r.json()).then(({ key }) => ({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    })));
    const sub = event.newSubscription ?? (await self.registration.pushManager.subscribe(options));
    if (old) {
      await fetch(api('resubscribe'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), replaces: old.endpoint }),
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data?.url || self.registration.scope;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
