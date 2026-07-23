(() => {
  "use strict";

  const layer = document.getElementById("appFrameLayer");
  const frame = document.getElementById("appFrame");
  const homeApp = document.querySelector(".home-app");

  async function unlockAudioFromHomeTap() {
    const engine = window.ShianAudioEngine;
    if (!engine) throw new Error("音声エンジンを読み込めません。");

    const ctx = await engine.resume();

    // ユーザー操作内で無音バッファを再生し、iOS・Androidの音声利用を有効化します。
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
        // Web Audio非対応時も、ページ自体は開けるようにします。
        location.href = link.href;
      }
    });
  });

  frame.addEventListener("load", () => {
    try {
      const url = new URL(frame.contentWindow.location.href);
      const path = url.pathname.replace(/\/+/g, "/");

      // 子画面の「ホームへ戻る」で、ホームをiframe内に重ねないようにします。
      if (path.endsWith("/index.html") || path.endsWith("/shamityou-main/")) {
        const isProjectHome =
          !path.includes("/mimi-game/") &&
          !path.includes("/erika/") &&
          !path.includes("/tuner/");
        if (isProjectHome) returnHome();
      }
    } catch (_) {
      // about:blank 読込時などは何もしません。
    }
  });

  window.ShianReturnHome = returnHome;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("./service-worker.js");
      } catch (error) {
        console.warn("Service Worker registration failed:", error);
      }
    });
  }
})();
