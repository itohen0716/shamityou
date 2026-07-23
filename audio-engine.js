(() => {
  "use strict";

  // ホーム画面内のアプリフレームで開かれた場合は、
  // ホームで開始したWeb Audio APIをそのまま引き継ぎます。
  try {
    if (window.parent && window.parent !== window && window.parent.ShianAudioEngine) {
      window.ShianAudioEngine = window.parent.ShianAudioEngine;
      return;
    }
  } catch (_) {
    // 単独で開いた場合は、このページ内で音声エンジンを作成します。
  }


  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const AUDIO_URL = "./sounds/teacher-1to12-octave.wav";
  const FADE_SECONDS = 0.018;

  let context = null;
  let buffer = null;
  let loadingPromise = null;
  let activeSource = null;
  let activeGain = null;

  function getContext() {
    if (!AudioContextClass) {
      throw new Error("このブラウザはWeb Audio APIに対応していません。");
    }
    if (!context) context = new AudioContextClass();
    return context;
  }

  async function resume() {
    const ctx = getContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }

  async function load() {
    if (buffer) return buffer;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const ctx = await resume();
      const response = await fetch(AUDIO_URL);
      if (!response.ok) throw new Error("基準音源を読み込めません。");
      buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      return buffer;
    })();

    try {
      return await loadingPromise;
    } finally {
      loadingPromise = null;
    }
  }

  function stop(fade = true) {
    if (!activeSource || !context) return;

    const source = activeSource;
    const gain = activeGain;
    activeSource = null;
    activeGain = null;

    try {
      if (fade && gain) {
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS);
        source.stop(now + FADE_SECONDS + 0.005);
      } else {
        source.stop();
      }
    } catch (_) {
      // すでに停止済みの場合は何もしません。
    }
  }

  async function play(noteNumber) {
    const segments = window.ShianSoundSegments;
    const segment = segments && segments[noteNumber];
    if (!segment) throw new Error(`音番号${noteNumber}の区間がありません。`);

    const ctx = await resume();
    const audioBuffer = await load();
    stop(false);

    const duration = Math.max(0.05, segment.end - segment.start);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = audioBuffer;
    source.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const fade = Math.min(FADE_SECONDS, duration / 4);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.92, now + fade);
    gain.gain.setValueAtTime(0.92, now + Math.max(fade, duration - fade));
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);

    activeSource = source;
    activeGain = gain;

    source.addEventListener("ended", () => {
      if (activeSource === source) {
        activeSource = null;
        activeGain = null;
      }
    }, { once: true });

    source.start(now, segment.start, duration);
    return duration;
  }

  window.ShianAudioEngine = Object.freeze({
    load,
    play,
    stop,
    resume,
    getContext
  });
})();
