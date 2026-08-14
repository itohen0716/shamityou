const CACHE_PREFIX = "shian-shamisen-";
const CACHE_NAME = "shian-shamisen-v4.1-r12-20260814";

/*
 * 更新方針
 * - HTML / JS / CSS / JSON はオンライン時に必ずネットワークを優先
 * - fetch は cache:"no-store" でブラウザHTTPキャッシュも迂回
 * - 取得成功した最新版だけを現在のCache Storageへ保存
 * - 新しいService Worker有効化時に旧 shian-shamisen-* キャッシュを全削除
 * - 音源は大きいためCache First。ただしSW更新時に旧キャッシュごと破棄される
 * - オフライン時のみ保存済みキャッシュへフォールバック
 */

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./images/icons/icon-192.png",
  "./images/icons/icon-512.png",
  "./images/home/shami-home.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // install時もHTTPキャッシュを使わず最新版を取得
    await Promise.all(
      CORE_ASSETS.map(async (url) => {
        try {
          const request = new Request(url, { cache: "reload" });
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(url, response.clone());
          }
        } catch (_) {
          // 1ファイルの失敗でService Worker全体の更新を止めない
        }
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    // このアプリの旧キャッシュを確実に全削除
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );

    // 開いているページを即座に新SWの管理下へ
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data?.type === "CLEAR_OLD_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })());
  }
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isTeacherAudio(request) {
  return new URL(request.url).pathname.endsWith(
    "/sounds/teacher-1to12-octave.wav"
  );
}

function isFreshCodeRequest(request) {
  const url = new URL(request.url);

  return (
    request.mode === "navigate" ||
    /\.(?:html?|js|css|json|webmanifest)$/i.test(url.pathname)
  );
}

async function networkFirstFresh(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // 重要：通常のHTTPキャッシュも使わせない
    const freshRequest = new Request(request, {
      cache: "no-store"
    });

    const response = await fetch(freshRequest);

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (_) {
    const cached = await cache.match(request);

    if (cached) return cached;

    if (request.mode === "navigate") {
      return (
        (await cache.match("./index.html")) ||
        (await caches.match("./index.html"))
      );
    }

    throw _;
  }
}

async function cacheFirstAudio(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(
    new Request(request, { cache: "no-store" })
  );

  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(
      new Request(request, { cache: "no-store" })
    );

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || !isSameOrigin(request)) {
    return;
  }

  if (isTeacherAudio(request)) {
    event.respondWith(cacheFirstAudio(request));
    return;
  }

  if (isFreshCodeRequest(request)) {
    event.respondWith(networkFirstFresh(request));
    return;
  }

  event.respondWith(networkFirstAsset(request));
});
