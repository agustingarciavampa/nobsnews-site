// Lets Nobsnews be installed like an app and open without a connection.
// Every request tries the network first, so readers always get the latest
// page and news; the copy saved from the last visit is used only when offline.

const SAVED = 'nobsnews-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SAVED).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== SAVED).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SAVED).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, {ignoreSearch: true})),
  );
});
