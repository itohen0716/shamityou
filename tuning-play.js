(() => {
  "use strict";

  const BASE = {1:174.61,2:164.81,3:155.56,4:146.83,5:138.59,6:130.81,7:123.47,8:116.54,9:110,10:103.83,11:98,12:92.5};
  const MODES = {
    hon: { label: "本調子", ratios: [1, 4/3, 2] },
    niage: { label: "二上り", ratios: [1, 3/2, 2] },
    sansage: { label: "三下り", ratios: [1, 4/3, 16/9] }
  };
  const ORDER = ["ichi", "ni", "san"];
  const LABELS = { ichi: "一の糸", ni: "二の糸", san: "三の糸" };
  const SCENES = { go:"shami_go.png", next2:"shami_next2.png", next3:"shami_next3.png", complete:"shami_complete.png" };
  const EXPRESSIONS = { listening:"shami_listening.png", adjust:"shami_adjust.png", ok:"shami_ok.png", retry:"shami_retry.png" };
  const $ = (id) => document.getElementById(id);
  const els = {
    summary:$("playSummary"), hz:[$("hzIchi"),$("hzNi"),$("hzSan")], stop:$("stopButton"),
    mic:$("micState"), needle:$("meterNeedle"), judgement:$("judgement"),
    expression:$("expressionImage"), message:$("shamiMessage"), overlay:$("sceneOverlay"), scene:$("sceneImage")
  };

  const tuning = localStorage.getItem("shian-tuning") || "hon";
  const practice = localStorage.getItem("shian-practice") || "sequence";
  const count = Math.max(1, Math.min(12, Number(localStorage.getItem("shian-count")) || 6));
  const mode = MODES[tuning] || MODES.hon;
  const notes = mode.ratios.map((ratio) => BASE[count] * ratio);
  const noteNumbers = (window.ShianTuningMap[tuning] || window.ShianTuningMap.hon)[count];

  let activeIndex = -1;
  let stream, analyser, micSource, rafId, referenceTimer;
  let running = false, changing = false, suppressUntil = 0, voicedSince = 0, stableSince = 0;

  function setFeedback(kind, message, judgement = message, ok = false) {
    els.expression.src = `./images/expressions/${EXPRESSIONS[kind]}`;
    els.message.textContent = message;
    els.judgement.textContent = judgement;
    els.judgement.classList.toggle("ok", ok);
  }
  function setNeedle(cents) {
    els.needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  }
  function updateButtons() {
    document.querySelectorAll("[data-string]").forEach((button, index) => {
      button.classList.toggle("active", index === activeIndex);
      button.disabled = practice === "sequence" && index !== activeIndex;
    });
  }
  async function showScene(key, milliseconds) {
    els.scene.src = `./images/tuning/${SCENES[key]}`;
    els.overlay.hidden = false;
    requestAnimationFrame(() => els.overlay.classList.add("show"));
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    els.overlay.classList.remove("show");
    await new Promise((resolve) => setTimeout(resolve, 260));
    els.overlay.hidden = true;
  }
  async function playReference() {
    if (!running || activeIndex < 0) return;
    const voice = await window.ShianAudioEngine.playSegment(noteNumbers[activeIndex]);
    suppressUntil = performance.now() + voice.duration * 1000 + 250;
  }
  function stopReference() {
    clearInterval(referenceTimer);
    referenceTimer = 0;
    window.ShianAudioEngine.stopAll();
  }
  function startReference() {
    stopReference();
    playReference().catch(handleError);
    referenceTimer = window.setInterval(() => playReference().catch(handleError), 3000);
  }
  async function ensureMicrophone() {
    if (stream?.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("マイクを利用できません。");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      video: false
    });
    const ctx = await window.ShianAudioEngine.resume();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    micSource = ctx.createMediaStreamSource(stream);
    micSource.connect(analyser);
  }
  function resetStability() {
    voicedSince = 0;
    stableSince = 0;
  }
  function pitchLoop() {
    cancelAnimationFrame(rafId);
    const ctx = window.ShianAudioEngine.getContext();
    const data = new Float32Array(analyser.fftSize);
    const tick = (now) => {
      if (!running) return;
      analyser.getFloatTimeDomainData(data);
      if (now < suppressUntil) {
        resetStability();
        els.mic.textContent = "基準音を再生中";
        rafId = requestAnimationFrame(tick);
        return;
      }
      const pitch = window.ShianPitch.autoCorrelate(data, ctx.sampleRate);
      if (pitch.frequency < 0 || pitch.clarity < 0.45) {
        resetStability();
        els.mic.textContent = "糸を弾いてください";
        setFeedback("listening", "一音ずつ、ゆっくり弾いてね", "音を待っています");
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (!voicedSince) voicedSince = now;
      let cents = 1200 * Math.log2(pitch.frequency / notes[activeIndex]);
      while (cents > 600) cents -= 1200;
      while (cents < -600) cents += 1200;
      setNeedle(cents);
      els.mic.textContent = `${LABELS[ORDER[activeIndex]]}を測定中`;

      // 弾き始めの250msはアタックとして判定から除外する。
      if (now - voicedSince < 250) {
        stableSince = 0;
        setFeedback("listening", "音が落ち着くのを待っています", "アタックを除外中");
      } else if (Math.abs(cents) <= 10) {
        if (!stableSince) stableSince = now;
        const elapsed = now - stableSince;
        setFeedback("ok", "そのまま保ってね", `合っています（${Math.min(1, elapsed / 1000).toFixed(1)}秒）`, true);
        if (elapsed >= 1000) matched();
      } else {
        stableSince = 0;
        const low = cents < 0;
        setFeedback("adjust", low ? "もう少し高くしてみよう" : "もう少し低くしてみよう", low ? "少し低いです" : "少し高いです");
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  async function matched() {
    if (changing) return;
    changing = true;
    stopReference();
    resetStability();
    setFeedback("ok", "ぴったりです！", "±10 cent以内で1秒安定しました", true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (practice === "single") {
      stopSession(false);
      changing = false;
      return;
    }
    if (activeIndex < 2) {
      await showScene(activeIndex === 0 ? "next2" : "next3", 1500);
      activeIndex += 1;
      updateButtons();
      setFeedback("listening", `${LABELS[ORDER[activeIndex]]}を合わせよう`);
      startReference();
      changing = false;
    } else {
      stopSession(false);
      await showScene("complete", 2600);
      setFeedback("ok", "調弦完了です！", "三本とも整いました", true);
      changing = false;
    }
  }
  async function startSession(index) {
    try {
      activeIndex = index;
      els.mic.textContent = "音源とマイクを準備中";
      await window.ShianAudioEngine.resume();
      await Promise.all([window.ShianAudioEngine.load(), ensureMicrophone()]);
      running = true;
      resetStability();
      updateButtons();
      startReference();
      pitchLoop();
      setFeedback("listening", "基準音のあとに弾いてね");
    } catch (error) { handleError(error); }
  }
  function stopSession(message = true) {
    running = false;
    stopReference();
    cancelAnimationFrame(rafId);
    resetStability();
    activeIndex = -1;
    setNeedle(0);
    updateButtons();
    if (message) els.mic.textContent = "停止しました";
  }
  function handleError(error) {
    console.error(error);
    stopSession(false);
    setFeedback("retry", "マイクの許可と音量を確認してください", error.message || "開始できませんでした");
  }
  async function initialize() {
    els.summary.textContent = `${count}本・${mode.label}・${practice === "sequence" ? "1→2→3 自動進行" : "一音ずつ"}`;
    els.hz.forEach((element, index) => { element.textContent = `${notes[index].toFixed(2)} Hz`; });
    document.querySelectorAll("[data-string]").forEach((button, index) => button.addEventListener("click", () => {
      if (practice === "single") { stopSession(false); startSession(index); }
    }));
    els.stop.addEventListener("click", () => stopSession());
    addEventListener("pagehide", () => { stopSession(false); stream?.getTracks().forEach((track) => track.stop()); });
    if (practice === "sequence") {
      activeIndex = 0;
      updateButtons();
      await showScene("go", 1500);
      await startSession(0);
    } else {
      updateButtons();
      els.mic.textContent = "合わせたい糸を選んでください";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once:true });
  else initialize();
})();
