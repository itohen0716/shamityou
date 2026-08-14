(() => {
  "use strict";

  const layer = document.getElementById("appFrameLayer");
  const frame = document.getElementById("appFrame");
  const homeApp = document.querySelector(".home-app");

  async function unlockAudioFromHomeTap() {
    const engine = window.ShianAudioEngine;
    if (!engine) throw new Error("音声エンジンを読み込めません。");

    const ctx = await engine.resume();

    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start();

    sessionStorage.setItem("shian-audio-unlocked", "1");
  }

  async function openApp(route) {
    await unlockAudioFromHomeTap();
    homeApp.hidden = true;
    layer.hidden = false;
    frame.src = route;
    document.body.classList.add("app-frame-open");
  }

  function returnHome() {
    frame.src = "about:blank";
    layer.hidden = true;
    homeApp.hidden = false;
    document.body.classList.remove("app-frame-open");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  document.querySelectorAll("[data-app-route]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await openApp(link.dataset.appRoute);
      } catch (error) {
        console.error(error);
        location.href = link.href;
      }
    });
  });

  frame.addEventListener("load", () => {
    try {
      const url = new URL(frame.contentWindow.location.href);
      const path = url.pathname.replace(/\/+/g, "/");

      if (path.endsWith("/index.html") || path.endsWith("/shamityou-main/")) {
        const isProjectHome =
          !path.includes("/mimi-game/") &&
          !path.includes("/erika/") &&
          !path.includes("/tuner/");

        if (isProjectHome) returnHome();
      }
    } catch (_) {}
  });

  window.ShianReturnHome = returnHome;

  async function registerFreshServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js",
        {
          updateViaCache: "none"
        }
      );

      // 毎回明示的に最新版SWを確認
      await registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      // 新SWへ切り替わったら1回だけ再読込
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        const key = "shian-sw-controller-reloaded";

        if (sessionStorage.getItem(key) === "1") return;

        sessionStorage.setItem(key, "1");
        location.reload();
      });

      // 旧キャッシュ削除も明示要求
      registration.active?.postMessage({
        type: "CLEAR_OLD_CACHES"
      });
    } catch (error) {
      console.warn("Service Worker registration failed:", error);
    }
  }

  window.addEventListener("load", registerFreshServiceWorker);
})();
