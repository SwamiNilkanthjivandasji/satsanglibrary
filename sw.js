/* Service worker.
 *  - એપની ફાઇલો (HTML/CSS/JS/આઇકન): network-first (ઓનલાઇન હોય તો હંમેશા નવી), ઓફલાઇન તો સેવ કરેલી.
 *  - books/books.json: network-first, ઓફલાઇન તો સેવ કરેલી.
 *  - books/*.xml: અહીં સંભાળતા નથી. તે એપ પોતે IndexedDB માં સેવ કરે છે અને અપડેટ ચકાસે છે.
 *  - Google Fonts અને fonts/ ફોલ્ડરની ફાઇલ: stale-while-revalidate (ઓફલાઇન પણ ફોન્ટ મળે).
 *    fonts/ ફાઇલ PRECACHE માં નથી મૂકી: ફાઇલ ન હોય તો આખું install નિષ્ફળ ન જાય તે માટે.
 * CACHE_VERSION બદલવાથી જૂની cache સાફ થાય. ફાઇલ યાદી બદલાય તો PRECACHE પણ સુધારવી.
 */
const CACHE_VERSION = 'v3';
const SHELL_CACHE = `satsang-shell-${CACHE_VERSION}`;
const FONT_CACHE = `satsang-fonts-${CACHE_VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/config.js',
  'js/util.js',
  'js/store.js',
  'js/parser.js',
  'js/loader.js',
  'js/search.js',
  'js/ui.js',
  'js/pwa.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('satsang-') && k !== SHELL_CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request, cacheName) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(request, { ignoreSearch: false }).then((hit) => hit || caches.match('index.html'));
    const timer = setTimeout(() => {
      fallback().then((hit) => {
        if (hit && !settled) {
          settled = true;
          resolve(hit);
        }
      });
    }, NETWORK_TIMEOUT_MS);

    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(cacheName).then((c) => c.put(request, copy));
        }
        if (!settled) {
          settled = true;
          resolve(res);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        fallback().then((hit) => {
          if (!settled) {
            settled = true;
            resolve(hit || Response.error());
          }
        });
      });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  const path = decodeURIComponent(url.pathname);
  if (/\/books\/[^/]+\.xml$/i.test(path)) return; // XML: એપ પોતે સંભાળે છે
  if (/\/fonts\/[^/]+\.(ttf|otf|woff2?)$/i.test(path)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // એપની ફાઇલો, નેવિગેશન અને books.json
  event.respondWith(networkFirst(request, SHELL_CACHE));
});
