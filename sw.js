/* G-CARD Director Service Worker */
const CACHE_NAME = 'gcard-director-v3';

// 起動時にキャッシュするコアアセット
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './news.js',
  './app.js',
  './app-2pick.js',
  './app-legacy-bridge.js',
  './card_meta.js',
  './deck-import.js',
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
  // APIリクエストはSWをスルー。公式カード画像だけは表示後に遅延キャッシュする。
  const url = new URL(e.request.url);
  if (url.pathname.includes('/api/')) return;
  const isOfficialCardImage = url.origin === 'https://godzilla-cardgame.com'
    && url.pathname.startsWith('/wordpress/wp-content/images/cardlist/');
  if (url.origin !== self.location.origin) {
    if (!isOfficialCardImage) return;
    const imageResponse = caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || (!response.ok && response.type !== 'opaque')) return response;
        const clone = response.clone();
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, clone))
          .catch(() => {})
          .then(() => response);
      });
    });
    e.respondWith(imageResponse);
    e.waitUntil(imageResponse.then(() => undefined, () => undefined));
    return;
  }

  // HTML/JS/CSSなどの中核ファイルは network-first にして、更新済みのメタ情報を優先する
  const pathname = url.pathname;
  const isCoreAsset = e.request.mode === 'navigate'
    || pathname.endsWith('/index.html')
    || pathname.endsWith('/news.js')
    || pathname.endsWith('/app.js')
    || pathname.endsWith('/app-2pick.js')
    || pathname.endsWith('/app-legacy-bridge.js')
    || pathname.endsWith('/card_meta.js')
    || pathname.endsWith('/deck-import.js')
    || pathname.endsWith('/styles.css')
    || pathname.endsWith('/manifest.webmanifest')
    || pathname.endsWith('/sw.js');

  if (isCoreAsset) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

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
