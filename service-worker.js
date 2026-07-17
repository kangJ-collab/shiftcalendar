const CACHE_VERSION = 'shiftcalendar-pwa-v3';
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
    const validCaches = new Set([
      STATIC_CACHE,
      RUNTIME_CACHE
    ]);

    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
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
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

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
  const cachedResponse = await caches.match(request);

  const networkResponse = fetch(request)
    .then(async response => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => null);

  return cachedResponse || networkResponse;
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 외부 GAS 요청 등은 서비스워커가 처리하지 않음
  if (url.origin !== self.location.origin) {
    return;
  }

  // 페이지는 인터넷 우선, 실패하면 저장된 화면 사용
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 공휴일과 보험 데이터는 최신 데이터 우선
  if (
    url.pathname.endsWith('/data/holidays.json') ||
    url.pathname.endsWith('/data/insurance.json')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 아이콘과 일반 파일은 캐시 우선 후 백그라운드 갱신
  event.respondWith(staleWhileRevalidate(request));
});