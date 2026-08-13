"use strict";

((async () => {
  let MASTER;
  try {
    MASTER = await window.ShianTuningMasterReady;
  } catch (error) {
    document.body.innerHTML =
      `<p style="padding:24px">${error.message || "調弦データを読み込めませんでした。"}</p>`;
    return;
  }
  if (!MASTER || typeof MASTER.get !== "function") {
    document.body.innerHTML =
      '<p style="padding:24px">調弦データを読み込めませんでした。</p>';
    throw new Error("ShianTuningMaster is unavailable.");
  }

  const MODE_SEQUENCE = "sequence";
  const MODE_SINGLE = "single";
  const judgementConfig = window.ShianJudgementConfig;
  const IN_TUNE_CENTS = judgementConfig?.toleranceCents ?? 7;
  const NEAR_CENTS = 15;
  const HOLD_MS = judgementConfig?.stableDurationMs ?? 1000;
  const TRANSITION_MS = 1500;
  const PITCH_DROPOUT_GRACE_MS = 350;
  const MAX_STABLE_FRAME_MS = 80;
  const MIN_FREQUENCY = 70;
  const MAX_FREQUENCY = 900;

  const NOTE_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const NOTE_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  const STRING_LABELS = ["一の糸", "二の糸", "三の糸"];

  const $ = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Element not found: ${id}`);
    return element;
  };

  const baseStringSelect = $("baseStringSelect");
  const tuningSelect = $("tuningSelect");
  const stringSelect = $("stringSelect");
  const stringField = $("stringField");
  const stringBadge = $("stringBadge");
  const targetText = $("targetText");
  const detectedNote = $("detectedNote");
  const frequencyValue = $("frequencyValue");
  const meterNeedle = $("meterNeedle");
  const guideText = $("guideText");
  const centValue = $("centValue");
  const progressPanel = $("progressPanel");
  const shamiImage = $("shamiImage");
  const startButton = $("startButton");
  const stopButton = $("stopButton");
  const statusText = $("statusText");
  const helpButton = $("helpButton");
  const helpDialog = $("helpDialog");
  const closeHelpButton = $("closeHelpButton");

  /** @type {AudioContext | null} */
  let audioContext = null;
  /** @type {MediaStream | null} */
  let mediaStream = null;
  /** @type {AnalyserNode | null} */
  let analyser = null;
  /** @type {Float32Array | null} */
  let timeBuffer = null;
  /** @type {number | null} */
  let rafId = null;

  let running = false;
  let mode = MODE_SEQUENCE;
  let currentStringIndex = 0;
  let stableDuration = 0;
  let lastInTuneAt = 0;
  let lastValidPitchAt = 0;
  let transitionLocked = false;
  let smoothedFrequency = null;
  let noPitchFrames = 0;
  let singleSuccessLatched = false;

  function getEntry() {
    return MASTER.get(Number(baseStringSelect.value), tuningSelect.value);
  }

  function getTargetFrequency() {
    return getEntry().frequencies[currentStringIndex];
  }

  function frequencyToMidi(frequency) {
    return 69 + 12 * Math.log2(frequency / 440);
  }

  function frequencyToNote(frequency) {
    const midi = Math.round(frequencyToMidi(frequency));
    const index = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const sharp = NOTE_SHARP[index];
    const flat = NOTE_FLAT[index];
    return {
      display: sharp === flat ? sharp : `${sharp} / ${flat}`,
      compact: sharp === flat ? sharp : `${sharp}・${flat}`,
      octave
    };
  }

  function formatTarget() {
    const frequency = getTargetFrequency();
    const note = frequencyToNote(frequency);
    return `${note.compact}${note.octave}・${frequency.toFixed(1)} Hz`;
  }

  function setImage(fileName, alt) {
    const nextSrc = `./images/${fileName}`;
    if (shamiImage.getAttribute("src") === nextSrc) return;

    shamiImage.classList.add("changing");
    window.setTimeout(() => {
      shamiImage.src = nextSrc;
      shamiImage.alt = alt;
      shamiImage.classList.remove("changing");
    }, 130);
  }

  function setGuide(text, state = "") {
    guideText.textContent = text;
    guideText.className = `guide-text${state ? ` ${state}` : ""}`;
  }

  function updateModeUI() {
    document.querySelectorAll(".mode-card").forEach((card) => {
      const active = card.dataset.mode === mode;
      card.classList.toggle("active", active);
      card.setAttribute("aria-pressed", String(active));
    });

    stringField.classList.toggle("hidden", mode === MODE_SEQUENCE);
    progressPanel.hidden = mode !== MODE_SEQUENCE;

    if (mode === MODE_SEQUENCE) {
      currentStringIndex = 0;
      stringSelect.value = "1";
    } else {
      currentStringIndex = Number(stringSelect.value) - 1;
    }
    resetProgress();
    updateTargetUI();
  }

  function updateTargetUI() {
    stringBadge.textContent = STRING_LABELS[currentStringIndex];
    targetText.textContent = `目標 ${formatTarget()}`;
  }

  function resetProgress() {
    document.querySelectorAll(".progress-step").forEach((step, index) => {
      step.classList.toggle("active", index === currentStringIndex);
      step.classList.remove("done");
    });
  }

  function updateProgress(completedIndex = null) {
    document.querySelectorAll(".progress-step").forEach((step, index) => {
      step.classList.toggle("active", index === currentStringIndex);
      if (completedIndex !== null && index <= completedIndex) {
        step.classList.add("done");
      }
    });
  }

  function resetMeter(message = "マイクを開始してください") {
    singleSuccessLatched = false;
    detectedNote.textContent = "—";
    frequencyValue.textContent = "--.-";
    meterNeedle.style.left = "50%";
    meterNeedle.style.background = "var(--brown)";
    centValue.textContent = "-- cent";
    setGuide(message);
    resetStableDuration();
    lastValidPitchAt = 0;
    smoothedFrequency = null;
    noPitchFrames = 0;
    if (!transitionLocked) {
      setImage("shami-listening.png", "耳を澄まして音を聴くシャミ");
    }
  }

  function centsFromTarget(frequency, target) {
    return 1200 * Math.log2(frequency / target);
  }

  function normalizePitchToTarget(frequency, target) {
    let normalized = frequency;
    const lowerBoundary = target / Math.SQRT2;
    const upperBoundary = target * Math.SQRT2;

    while (normalized < lowerBoundary) normalized *= 2;
    while (normalized > upperBoundary) normalized /= 2;

    return normalized;
  }

  function resetStableDuration() {
    stableDuration = 0;
    lastInTuneAt = 0;
  }

  function updateMeter(frequency, timestamp) {
    const target = getTargetFrequency();
    const cents = centsFromTarget(frequency, target);
    const note = frequencyToNote(frequency);
    const clamped = Math.max(-50, Math.min(50, cents));
    const position = 50 + clamped;

    detectedNote.textContent = note.display;
    frequencyValue.textContent = frequency.toFixed(1);
    centValue.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(1)} cent`;
    meterNeedle.style.left = `${position}%`;

    const absolute = Math.abs(cents);

    if (absolute <= IN_TUNE_CENTS) {
      if (mode === MODE_SINGLE) singleSuccessLatched = true;
      meterNeedle.style.background = "var(--success)";
      setGuide("ぴったりです！", "ok");
      setImage("shami-ok.png", "音が合って喜ぶシャミ");

      if (mode === MODE_SEQUENCE && !transitionLocked) {
        if (lastInTuneAt) {
          stableDuration += Math.min(timestamp - lastInTuneAt, MAX_STABLE_FRAME_MS);
        }
        lastInTuneAt = timestamp;
        if (stableDuration >= HOLD_MS) {
          void completeCurrentString();
        }
      }
      return;
    }

    singleSuccessLatched = false;
    resetStableDuration();
    setImage("shami-listening.png", "耳を澄まして音を聴くシャミ");

    if (cents < 0) {
      meterNeedle.style.background = "var(--blue-deep)";
      setGuide(absolute <= NEAR_CENTS ? "あと少し上げてね" : "音を上げてね", "low");
    } else {
      meterNeedle.style.background = "var(--pink-deep)";
      setGuide(absolute <= NEAR_CENTS ? "あと少し下げてね" : "音を下げてね", "high");
    }
  }

  async function completeCurrentString() {
    if (transitionLocked) return;
    transitionLocked = true;
    resetStableDuration();

    const completed = currentStringIndex;
    updateProgress(completed);

    if (currentStringIndex >= 2) {
      setImage("shami-complete.png", "調弦が整って喜ぶシャミ");
      setGuide("三弦とも整いました！", "ok");
      centValue.textContent = "完了";
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      await stopTuner(false);
      startButton.textContent = "もう一度はじめる";
      transitionLocked = false;
      return;
    }

    const nextIndex = currentStringIndex + 1;
    if (nextIndex === 1) {
      setImage("shami-next2.png", "次は二の糸と案内するシャミ");
      setGuide("次は二の糸だよ");
    } else {
      setImage("shami-next3.png", "次は三の糸と案内するシャミ");
      setGuide("次は三の糸だよ");
    }

    await new Promise((resolve) => window.setTimeout(resolve, TRANSITION_MS));

    currentStringIndex = nextIndex;
    stringSelect.value = String(currentStringIndex + 1);
    updateTargetUI();
    updateProgress(completed);
    resetMeter("糸を鳴らしてください");
    transitionLocked = false;
  }

  /**
   * 正規化自己相関による基本周波数推定。
   * @param {Float32Array} buffer
   * @param {number} sampleRate
   * @returns {number}
   */
  function detectPitch(buffer, sampleRate) {
    let rms = 0;
    let mean = 0;

    for (let i = 0; i < buffer.length; i += 1) {
      mean += buffer[i];
    }
    mean /= buffer.length;

    for (let i = 0; i < buffer.length; i += 1) {
      const value = buffer[i] - mean;
      rms += value * value;
    }
    rms = Math.sqrt(rms / buffer.length);

    if (rms < 0.009) return -1;

    const minLag = Math.floor(sampleRate / MAX_FREQUENCY);
    const maxLag = Math.min(
      Math.floor(sampleRate / MIN_FREQUENCY),
      Math.floor(buffer.length / 2)
    );

    let bestLag = -1;
    let bestCorrelation = 0;
    const length = buffer.length - maxLag;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sumXY = 0;
      let sumXX = 0;
      let sumYY = 0;

      for (let i = 0; i < length; i += 1) {
        const x = buffer[i] - mean;
        const y = buffer[i + lag] - mean;
        sumXY += x * y;
        sumXX += x * x;
        sumYY += y * y;
      }

      const denominator = Math.sqrt(sumXX * sumYY);
      if (denominator === 0) continue;

      const correlation = sumXY / denominator;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestLag < 0 || bestCorrelation < 0.72) return -1;

    // 前後の相関値から放物線補間して精度を上げる
    const correlationAt = (lag) => {
      let sumXY = 0;
      let sumXX = 0;
      let sumYY = 0;
      for (let i = 0; i < length; i += 1) {
        const x = buffer[i] - mean;
        const y = buffer[i + lag] - mean;
        sumXY += x * y;
        sumXX += x * x;
        sumYY += y * y;
      }
      const denominator = Math.sqrt(sumXX * sumYY);
      return denominator ? sumXY / denominator : 0;
    };

    let refinedLag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const left = correlationAt(bestLag - 1);
      const center = bestCorrelation;
      const right = correlationAt(bestLag + 1);
      const divisor = left - 2 * center + right;
      if (Math.abs(divisor) > 1e-8) {
        refinedLag += 0.5 * (left - right) / divisor;
      }
    }

    return sampleRate / refinedLag;
  }

  function analyse(timestamp) {
    if (!running || !analyser || !timeBuffer || !audioContext) return;

    if (transitionLocked) {
      rafId = window.requestAnimationFrame(analyse);
      return;
    }

    analyser.getFloatTimeDomainData(timeBuffer);
    const rawFrequency = detectPitch(timeBuffer, audioContext.sampleRate);

    if (rawFrequency >= MIN_FREQUENCY && rawFrequency <= MAX_FREQUENCY) {
      noPitchFrames = 0;
      lastValidPitchAt = timestamp;
      const measuredFrequency = normalizePitchToTarget(rawFrequency, getTargetFrequency());
      smoothedFrequency =
        smoothedFrequency === null
          ? measuredFrequency
          : smoothedFrequency * 0.76 + measuredFrequency * 0.24;
      updateMeter(smoothedFrequency, timestamp);
      statusText.textContent = "";
    } else {
      noPitchFrames += 1;
      if (lastValidPitchAt && timestamp - lastValidPitchAt > PITCH_DROPOUT_GRACE_MS) {
        resetStableDuration();
        smoothedFrequency = null;
      }
      if (noPitchFrames > 12 && !transitionLocked && !singleSuccessLatched) {
        setGuide("もう一度、糸を鳴らしてね");
        setImage("shami-listening.png", "耳を澄まして音を聴くシャミ");
      }
    }

    rafId = window.requestAnimationFrame(analyse);
  }

  async function startTuner() {
    if (running || transitionLocked) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      statusText.textContent =
        "このブラウザはマイク入力に対応していません。Chromeで開いてください。";
      return;
    }

    try {
      statusText.textContent = "マイクの使用許可を確認しています…";
      startButton.disabled = true;

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });

      audioContext = new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      timeBuffer = new Float32Array(analyser.fftSize);
      running = true;
      startButton.disabled = true;
      startButton.textContent = "測定中";
      stopButton.disabled = false;
      statusText.textContent = "";
      resetMeter("糸を鳴らしてください");
      rafId = window.requestAnimationFrame(analyse);
    } catch (error) {
      console.error(error);
      statusText.textContent =
        "マイクを開始できませんでした。ブラウザのマイク許可を確認してください。";
      await stopTuner(true);
    }
  }

  async function stopTuner(reset = true) {
    running = false;

    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    if (audioContext && audioContext.state !== "closed") {
      try {
        await audioContext.close();
      } catch (error) {
        console.warn("AudioContextを終了できませんでした。", error);
      }
    }

    audioContext = null;
    analyser = null;
    timeBuffer = null;
    startButton.disabled = false;
    startButton.textContent = "● マイクを開始";
    stopButton.disabled = true;

    if (reset) resetMeter();
  }

  document.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", async () => {
      await stopTuner(true);
      mode = card.dataset.mode === MODE_SINGLE ? MODE_SINGLE : MODE_SEQUENCE;
      updateModeUI();
    });
  });

  baseStringSelect.addEventListener("change", async () => {
    await stopTuner(true);
    updateTargetUI();
  });

  tuningSelect.addEventListener("change", async () => {
    await stopTuner(true);
    updateTargetUI();
  });

  stringSelect.addEventListener("change", async () => {
    await stopTuner(true);
    currentStringIndex = Number(stringSelect.value) - 1;
    updateTargetUI();
  });

  startButton.addEventListener("click", () => void startTuner());
  stopButton.addEventListener("click", () => void stopTuner(true));

  helpButton.addEventListener("click", () => helpDialog.showModal());
  closeHelpButton.addEventListener("click", () => helpDialog.close());
  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });

  window.addEventListener("pagehide", () => {
    void stopTuner(false);
  });

  // 画像が欠けている場合も画面を壊さない
  shamiImage.addEventListener("error", () => {
    shamiImage.style.visibility = "hidden";
  });

  updateModeUI();
  resetMeter();
})());
