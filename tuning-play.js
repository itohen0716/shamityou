(async () => {
  "use strict";

  const judgementConfig = window.ShianJudgementConfig;
  const TUNING_TOLERANCE_CENTS = judgementConfig?.toleranceCents ?? 7;
  const SEQUENCE_ADVANCE_DELAY_MS = judgementConfig?.sequenceAdvanceDelayMs ?? 500;
  const PITCH_DROPOUT_GRACE_MS = 350;
  const SMOOTHING_ALPHA = 0.28;
  const REFERENCE_INTERVAL_MS = 4200;

  const ORDER = ["ichi", "ni", "san"];
  const LABELS = { ichi: "一の糸", ni: "二の糸", san: "三の糸" };
  const SCENES = { go:"shami_go.png", next2:"shami_next2.png", next3:"shami_next3.png", complete:"shami_complete.png" };
  const EXPRESSIONS = { listening:"shami_listening.png", adjust:"shami_adjust.png", ok:"shami_ok.png", retry:"shami_retry.png" };
  const $ = (id) => document.getElementById(id);
  const els = {
    summary:$("playSummary"), hz:[$("hzIchi"),$("hzNi"),$("hzSan")], stop:$("stopButton"),
    mic:$("micState"), targetHz:$("activeTargetHz"), measuredHz:$("measuredHz"),
    needle:$("meterNeedle"), judgement:$("judgement"),
    expression:$("expressionImage"), message:$("shamiMessage"), overlay:$("sceneOverlay"), scene:$("sceneImage")
  };

  const tuning = localStorage.getItem("shian-tuning") || "hon";
  const practice = localStorage.getItem("shian-practice") || "sequence";
  const count = Math.max(1, Math.min(12, Number(localStorage.getItem("shian-count")) || 6));
  let master;
  try {
    master = await window.ShianTuningMasterReady;
  } catch (error) {
    els.mic.textContent = "調弦データを読み込めません";
    els.judgement.textContent = error.message || "再読み込みしてください";
    return;
  }
  const target = master.get(count, tuning);
  const notes = target.frequencies;

  let activeIndex = -1;
  let stream, analyser, micSource, rafId, referenceTimer, inTuneTimer;
  let running = false, changing = false, suppressUntil = 0, voicedSince = 0;
  let inTuneStartedAt = 0, lastValidPitchAt = 0, smoothedFrequency = 0;

  function setFeedback(kind, message, judgement = message, ok = false) {
    els.expression.src = `./images/expressions/${EXPRESSIONS[kind]}`;
    els.message.textContent = message;
    els.judgement.textContent = judgement;
    els.judgement.classList.toggle("ok", ok);
  }
  function setGuidance(kind, message) {
    els.expression.src = `./images/expressions/${EXPRESSIONS[kind]}`;
    els.message.textContent = message;
  }
  function setNeedle(cents) {
    els.needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  }
  function isInTune(cents) {
    return Math.abs(cents) <= TUNING_TOLERANCE_CENTS;
  }
  function updateActiveTarget() {
    els.targetHz.textContent = activeIndex < 0 ? "--.-Hz" : master.formatHz(notes[activeIndex]).replace(" ", "");
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
    const voice = await window.ShianAudioEngine.playFrequency(notes[activeIndex]);
    suppressUntil = performance.now() + voice.duration * 1000 + 250;
  }
  function stopReference() {
    clearInterval(referenceTimer);
    referenceTimer = 0;
    window.ShianAudioEngine.stopAll();
  }
  function startReference() {
    stopReference();
    els.mic.textContent = "基準音を再生中";
    playReference().catch(handleError);
    referenceTimer = window.setInterval(() => playReference().catch(handleError), REFERENCE_INTERVAL_MS);
  }
  async function ensureMicrophone() {
    if (stream?.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("マイクを利用できません。");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      },
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
    lastValidPitchAt = 0;
    smoothedFrequency = 0;
    resetStableDuration();
  }
  function resetStableDuration() {
    clearTimeout(inTuneTimer);
    inTuneTimer = 0;
    inTuneStartedAt = 0;
  }
  function acceptSequenceSuccess(now) {
    if (inTuneStartedAt || inTuneTimer || changing) return;
    inTuneStartedAt = now;
    const expectedIndex = activeIndex;
    stopReference();
    els.mic.textContent = `${LABELS[ORDER[activeIndex]]}が合いました`;
    setFeedback("ok", "ぴったりです！", "合っています", true);
    inTuneTimer = window.setTimeout(() => {
      inTuneTimer = 0;
      if (!running || changing || activeIndex !== expectedIndex) {
        resetStableDuration();
        return;
      }
      void matched();
    }, SEQUENCE_ADVANCE_DELAY_MS);
  }
  function holdSingleSuccess() {
    running = false;
    stopReference();
    cancelAnimationFrame(rafId);
    resetStability();
    els.mic.textContent = `${LABELS[ORDER[activeIndex]]}が合いました`;
    setFeedback("ok", "ぴったりです！", "合っています", true);
  }
  function smoothPitch(frequency) {
    if (!smoothedFrequency) {
      smoothedFrequency = frequency;
      return smoothedFrequency;
    }
    const jump = Math.abs(1200 * Math.log2(frequency / smoothedFrequency));
    smoothedFrequency = jump > 120
      ? frequency
      : smoothedFrequency * (1 - SMOOTHING_ALPHA) + frequency * SMOOTHING_ALPHA;
    return smoothedFrequency;
  }
  function pitchLoop() {
    cancelAnimationFrame(rafId);
    const ctx = window.ShianAudioEngine.getContext();
    const data = new Float32Array(analyser.fftSize);
    const tick = (now) => {
      if (!running) return;
      if (changing) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (inTuneTimer) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      analyser.getFloatTimeDomainData(data);
      if (now < suppressUntil) {
        resetStability();
        els.mic.textContent = "基準音を再生中";
        rafId = requestAnimationFrame(tick);
        return;
      }
      const pitch = window.ShianPitch.autoCorrelate(data, ctx.sampleRate);
      if (pitch.frequency < 0 || pitch.clarity < 0.45) {
        if (lastValidPitchAt && now - lastValidPitchAt > PITCH_DROPOUT_GRACE_MS) {
          voicedSince = 0;
          smoothedFrequency = 0;
          resetStableDuration();
          els.mic.textContent = "もう一度、糸を弾いてください";
        } else if (!lastValidPitchAt) {
          els.mic.textContent = "糸を弾いてください";
        }
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastValidPitchAt = now;
      if (!voicedSince) voicedSince = now;
      const measuredFrequency = smoothPitch(pitch.frequency);
      const cents = 1200 * Math.log2(measuredFrequency / notes[activeIndex]);
      setNeedle(cents);
      els.measuredHz.textContent = master.formatHz(measuredFrequency).replace(" ", "");
      els.mic.textContent = `${LABELS[ORDER[activeIndex]]}を測定中`;

      // 弾き始めの250msはアタックとして判定から除外する。
      if (now - voicedSince < 250) {
        resetStableDuration();
        setFeedback("listening", "音が落ち着くのを待っています", "アタックを除外中");
      } else if (isInTune(cents)) {
        if (practice === "single") {
          holdSingleSuccess();
          return;
        }
        acceptSequenceSuccess(now);
      } else {
        resetStableDuration();
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
    setFeedback("ok", "ぴったりです！", "合っています", true);
    if (practice === "single") {
      holdSingleSuccess();
      changing = false;
      return;
    }
    if (activeIndex < 2) {
      const completedIndex = activeIndex;
      activeIndex = completedIndex + 1;
      updateActiveTarget();
      updateButtons();
      try {
        await showScene(completedIndex === 0 ? "next2" : "next3", 1500);
      } catch (error) {
        console.error("次の糸の案内画像を表示できませんでした", error);
      }
      if (!running || activeIndex < 0) {
        changing = false;
        return;
      }
      setGuidance("listening", `${LABELS[ORDER[activeIndex]]}を合わせよう`);
      startReference();
      changing = false;
    } else {
      stopSession(false);
      await showScene("complete", 2600);
      setGuidance("ok", "調弦完了です！");
      changing = false;
    }
  }
  async function startSession(index) {
    try {
    activeIndex = index;
      updateActiveTarget();
      els.mic.textContent = "音源とマイクを準備中";
      await window.ShianAudioEngine.resume();
      await Promise.all([window.ShianAudioEngine.load(), ensureMicrophone()]);
      running = true;
      resetStability();
      updateButtons();
      startReference();
      pitchLoop();
      setGuidance("listening", "基準音のあとに弾いてね");
    } catch (error) { handleError(error); }
  }
  function stopSession(message = true) {
    running = false;
    stopReference();
    cancelAnimationFrame(rafId);
    resetStability();
    activeIndex = -1;
    setNeedle(0);
    updateActiveTarget();
    updateButtons();
    if (message) els.mic.textContent = "停止しました";
  }
  function handleError(error) {
    console.error(error);
    stopSession(false);
    setFeedback("retry", "マイクの許可と音量を確認してください", error.message || "開始できませんでした");
  }
  async function initialize() {
    els.summary.textContent = `${count}本・${target.label}・${practice === "sequence" ? "1→2→3 自動進行" : "一音ずつ"}`;
    els.hz.forEach((element, index) => { element.textContent = master.formatHz(notes[index]); });
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
