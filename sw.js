// 홈 화면에 추가했을 때 앱처럼 열리게 하는 서비스 워커. 이 페이지의 파일만 다루고 Gemini 요청에는 끼어들지 않는다.
// 새 버전이 바로 반영되도록 먼저 인터넷에서 받고, 안 되면(오프라인) 저장해 둔 것을 쓴다.
const CACHE = "lecture-app-v3";
const FILES = ["./", "index.html", "app.js", "core.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
