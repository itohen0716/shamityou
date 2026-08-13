const CACHE_NAME = "shian-shamisen-v4.1-r8";
const APP_SHELL = [
  "./","./index.html","./tuning.html","./tuning-play.html","./style.css?v=413",
  "./home.js?v=410","./setup.js?v=410","./tuner.js?v=413","./sound-segments.js?v=410",
  "./judgement-config.js?v=410","./tuning-data.js?v=410","./tuning-master.json","./audio-engine.js?v=411","./tuning-play.js?v=416",
  "./mimi-game/index.html","./mimi-game/game.css?v=411","./mimi-game/game.js?v=110",
  "./tuner/index.html","./tuner/style.css","./tuner/app.js?v=412",
  "./manifest.webmanifest","./sounds/teacher-1to12-octave.wav",
  "./images/home/shami-home.png","./images/home/icon-tuning.png","./images/home/icon-ear.png","./images/home/tyu.png","./images/home/syamisen.png","./images/home/icon-erika.png",
  "./images/buttons/hon.png","./images/buttons/niage.png","./images/buttons/sansage.png",
  "./images/icons/icon-192.png","./images/icons/icon-512.png","./images/icons/icon-512-maskable.png",
  "./images/tuning/shami_go.png","./images/tuning/shami_next2.png","./images/tuning/shami_next3.png","./images/tuning/shami_complete.png",
  "./images/expressions/shami_adjust.png","./images/expressions/shami_ok.png","./images/expressions/shami_retry.png","./images/expressions/shami_listening.png",
  "./mimi-game/images/shami_listening.png","./mimi-game/images/shami_correct.png","./mimi-game/images/shami_thinking.png",
  "./mimi-game/images/mimi-icon.png","./mimi-game/images/shami_timeup.png","./mimi-game/images/shami_finish.png","./mimi-game/images/shami_master.png","./mimi-game/images/shami_ready.png",
  "./erika/index.html","./erika/style.css","./erika/script.js","./erika/Image/erika-profile.jpg",
  "./yomoyama/index.html","./yomoyama/style.css?v=2","./yomoyama/script.js?v=2","./yomoyama/images/eri.png","./yomoyama/images/tuning-without-tuner.png"
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
