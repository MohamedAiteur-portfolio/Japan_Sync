// Service worker : rend le site utilisable hors-ligne (wifi/data limités en voyage).
// Stratégie volontairement simple :
//  - index.html (la coquille de l'appli) : réseau d'abord, secours sur le cache
//    si hors-ligne, pour toujours servir la dernière version en priorité.
//  - images/manifest : cache d'abord, car ils changent rarement.
//  - tout le reste (Firebase, CDN Font Awesome, APIs météo/change/maps) : on ne
//    touche pas, laissé au réseau normal.
// CACHE_VERSION doit être incrémenté à chaque modification de ce fichier pour
// forcer le nettoyage de l'ancien cache.
const CACHE_VERSION = 'v33';
const CACHE_NAME = `cap-commun-cache-${CACHE_VERSION}`;

const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './css/styles.css',
    './js/app.js',
    './js/flight-api-config.js',
    './js/currency.js',
    './js/pwa.js',
    './images/cap-commun.svg',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/travel/lisbon.jpg',
    './images/travel/tokyo.jpg',
    './images/travel/coast.jpg',
    './images/travel/journey.jpg'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // Firebase/CDN/APIs externes : réseau normal

    const isShell = req.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/');

    if (isShell) {
        event.respondWith(
            fetch(req)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
                    return res;
                })
                .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => cached || fetch(req).then(res => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
            return res;
        }))
    );
});
