const CACHE_NAME = "shian-shamisen-v4.0.0";
const APP_SHELL = [
  "./","./index.html","./tuning.html","./tuning-play.html","./style.css?v=400",
  "./home.js?v=400","./setup.js?v=400","./tuner.js?v=400","./sound-segments.js?v=400",
  "./tuning-map.js?v=400","./audio-engine.js?v=400","./tuning-play.js?v=400",
  "./mimi-game/index.html","./mimi-game/game.css?v=400","./mimi-game/game.js?v=400",
  "./manifest.webmanifest","./sounds/teacher-1to12-octave.wav",
  "./images/icons/icon-192.png","./images/icons/icon-512.png","./images/icons/icon-512-maskable.png",
  "./images/tuning/shami_go.png","./images/tuning/shami_next2.png","./images/tuning/shami_next3.png","./images/tuning/shami_complete.png",
  "./images/expressions/shami_adjust.png","./images/expressions/shami_ok.png","./images/expressions/shami_retry.png","./images/expressions/shami_listening.png",
  "./mimi-game/images/shami_listening.png","./mimi-game/images/shami_correct.png","./mimi-game/images/shami_thinking.png",
  "./mimi-game/images/shami_timeup.png","./mimi-game/images/shami_finish.png","./mimi-game/images/shami_master.png","./mimi-game/images/shami_ready.png"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  const request = event.request;
  const teacher = new URL(request.url).pathname.endsWith("/sounds/teacher-1to12-octave.wav");
  if (teacher) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
    return;
  }
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html"))));
});
