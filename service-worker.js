const CACHE_NAME = "shian-shamisen-v2.4.5.0";

const STATIC_FILES = [
  "./",
  "./index.html",
  "./tuning.html",
  "./style.css?v=245",
  "./home.js",
  "./tuner.js?v=245",
  "./tuning-app.js?v=245",
  "./manifest.webmanifest",
  "./images/icons/icon-192.png",
  "./images/icons/icon-512.png",
  "./images/icons/icon-512-maskable.png",
  "./images/home/shami-home.png",
  "./images/buttons/hon.png",
  "./images/buttons/niage.png",
  "./images/buttons/sansage.png",
  "./images/tuning/shami_go.png",
  "./images/tuning/shami_next2.png",
  "./images/tuning/shami_next3.png",
  "./images/tuning/shami_complete.png",
  "./images/expressions/shami_adjust.png",
  "./images/expressions/shami_ok.png",
  "./images/expressions/shami_retry.png",
  "./images/expressions/shami_listening.png",
  "./sounds/teacher-1to12-octave.wav"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isCode =
    event.request.mode === "navigate" ||
    /\.(?:html|css|js|webmanifest)$/.test(url.pathname);

  if (isCode) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      });
    })
  );
});