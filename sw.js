// Offline support: the app shell (including the ~11 MB OpenSCAD engine) is cached
// on first visit so the app works without a connection once added to the Home Screen.
// Bump VERSION when vendored files change (app files are fetched network-first).
const VERSION = 'v2';
const CACHE = `scad-online-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/viewer.js',
  'js/worker.js',
  'js/customizer.js',
  'js/examples.js',
  'vendor/three/three.module.js',
  'vendor/three/three.core.js',
  'vendor/three/OrbitControls.js',
  'vendor/openscad/openscad.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('scad-online-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Vendored libraries are pinned and large: cache-first. App files: network-first so
  // updates show up on the next load, falling back to the cache when offline.
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
