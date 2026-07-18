const CACHE_NAME="shian-shamisen-v2.0.1";
const FILES=[
  "./","./index.html","./tuning.html","./style.css","./app.js","./tuner.js",
  "./manifest.webmanifest",
  "./images/icons/icon-192.png","./images/icons/icon-512.png","./images/icons/icon-512-maskable.png",
  "./images/buttons/hon.png","./images/buttons/niage.png","./images/buttons/sansage.png",
  "./images/tuning/shami_go.png","./images/tuning/shami_next2.png",
  "./images/tuning/shami_next3.png","./images/tuning/shami_complete.png",
  "./images/expressions/shami_adjust.png","./images/expressions/shami_ok.png",
  "./images/expressions/shami_retry.png","./images/expressions/shami_listening.png",
  "./sounds/teacher-1to12-octave.wav"
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
    return response;
  })));
});