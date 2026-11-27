// 같은 주소(gmlduqzhd123-lab.github.io)의 다른 앱과 캐시 저장소를 같이 쓰므로 내 접두어 캐시만 지운다.
// 일람표 파일은 브라우저 안에서만 처리되고 여기 저장되지 않는다(페이지·스크립트·아이콘만 저장).
const CACHE = 'easy-nice-v1';
const CACHE_PREFIX = 'easy-nice-v';
const CORE = ['./', './index.html', './assets/app.js', './assets/style.css', './manifest.webmanifest', './qr.svg', './icons/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })
    .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
