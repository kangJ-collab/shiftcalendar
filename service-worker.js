const CACHE_VERSION = 'shiftcalendar-pwa-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const CORE_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

const OPTIONAL_FILES = [
  './icons/favicon-32.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './data/holidays.json',
  './data/insurance.json',
  './assets/gas-auth-1.png',
  './assets/gas-auth-2.png',
  './assets/gas-auth-3.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_FILES);
    await Promise.allSettled(
      OPTIONAL_FILES.map(file => cache.add(file))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const validCaches = new Set([STATIC_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();

    await Promise.all(
      names
        .filter(name => !validCaches.has(name))
        .map(name => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      return (
        await caches.match('./index.html') ||
        await caches.match('./')
      );
    }

    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request);

  const networkPromise = fetch(request).then(async response => {
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || networkPromise;
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.endsWith('/data/holidays.json') ||
    url.pathname.endsWith('/data/insurance.json')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
