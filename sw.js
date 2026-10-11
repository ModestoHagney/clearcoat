// Clearcoat service worker: versioned cache, so the app opens offline.
//
// DEPLOY RITUAL: bump VERSION below together with VERSION in next/app.js on
// every deploy. The new VERSION names a new cache; the app sees the new
// worker, saves, and reloads itself once to take it.

const VERSION = 'v0.68-pieces.68';
const CACHE = 'clearcoat-' + VERSION;

// The app's page and the icons. Every path here must exist in the repo, or
// the worker fails to install. The rest of the app is not listed: it is
// fetched fresh and kept as it goes, see below.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  // no skipWaiting here: the page asks for it (the SKIP_WAITING message
  // below) once it has saved
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('clearcoat-') && n !== CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept non-GET

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // The address the app had while it was being built now leads to the
    // site's own. Done here, not only in that page, because this worker is
    // the one thing that knows no older worker is still answering the site's
    // address with an old page (which sent visitors to next/, and so round
    // and round).
    if (req.mode === 'navigate' && /\/next\/(index\.html)?$/.test(url.pathname)) {
      event.respondWith(Response.redirect(url.pathname.replace(/next\/(index\.html)?$/, '') + url.search, 302));
      return;
    }
    // Everything the app loads comes fresh from the network, so a deploy
    // shows up on the next reload; each file is kept as it is fetched, and
    // the kept copy is used when there is no network.
    // ponytail: network first costs a round trip per file on every load;
    // precache the app and serve it cache-first if load time ever matters.
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
  } else {
    // cross-origin (Google Fonts, the icon search): network with cache
    // fallback, fresh when online, stale if offline; never precached
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
