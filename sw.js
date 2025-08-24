// Simple cache-first service worker (static assets + images + questions.json)
const CACHE = 'flashpad-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './questions.json',
  './images/demo-question.png',
  './images/demo-solution.png',
  './images/demo2-q.png',
  './images/demo2-a.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k === CACHE ? null : caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => 
        cached || fetch(e.request).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        }).catch(() => cached)
      )
    );
  }
});
