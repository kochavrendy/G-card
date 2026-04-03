/* G-CARD Director Service Worker */
const CACHE_NAME = 'gcard-director-v1';

// 起動時にキャッシュするコアアセット
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './app-2pick.js',
  './app-legacy-bridge.js',
  './card_meta.js',
  './styles.css',
  './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // APIリクエスト・外部CDN（QRcodeライブラリ等）はSWをスルー
  const url = new URL(e.request.url);
  if (url.pathname.includes('/api/') || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // 正常レスポンスのみキャッシュ（カード画像も含む）
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached); // オフライン時はキャッシュをフォールバック
    })
  );
});
