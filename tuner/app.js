"use strict";

(() => {
  /** @type {AudioContext | null} */
  let audioContext = null;
  /** @type {MediaStream | null} */
  let mediaStream = null;
  /** @type {AnalyserNode | null} */
  let analyser = null;
  /** @type {Float32Array | null} */
  let audioBuffer = null;
  /** @type {number | null} */
  let animationFrameId = null;
  let running = false;

  const NOTE_NAMES_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const NOTE_NAMES_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

  const baseStringSelect = document.getElementById("baseStringSelect");
  const tuningSelect = document.getElementById("tuningSelect");
  const stringSelect = document.getElementById("stringSelect");
  const frequencyValue = document.getElementById("frequencyValue");
  const detectedNote = document.getElementById("detectedNote");
  const octaveValue = document.getElementById("octaveValue");
  const guideText = document.getElementById("guideText");
  const centValue = document.getElementById("centValue");
  const needle = document.getElementById("needle");
  const targetNote = document.getElementById("targetNote");
  const targetFrequency = document.getElementById("targetFrequency");
  const startButton = document.getElementById("startButton");
  const stopButton = document.getElementById("stopButton");
  const statusText = document.getElementById("statusText");
  const helpButton = document.getElementById("helpButton");
  const helpDialog = document.getElementById("helpDialog");
  const closeHelpButton = document.getElementById("closeHelpButton");

  if (
    !baseStringSelect || !tuningSelect || !stringSelect ||
    !frequencyValue || !detectedNote || !octaveValue ||
    !guideText || !centValue || !needle || !targetNote ||
    !targetFrequency || !startButton || !stopButton ||
    !statusText || !helpButton || !helpDialog || !closeHelpButton
  ) {
    throw new Error("必要な画面要素が見つかりません。");
  }

  /**
   * 一の糸の本数を C2=1本 として半音ずつ上げる暫定対応。
   * 実運用の音域に合わせて後から調整可能。
   * @returns {number[]}
   */
  function getTargetMidiNotes() {
    const baseCount = Number(baseStringSelect.value);
    const tuning = tuningSelect.value;
    const selectedString = Number(stringSelect.value);

    const firstStringMidi = 35 + baseCount; // 1本=B2? 暫定的に 6本=F3 相当
    const intervals = {
      honchoshi: [0, 5, 12],
      niagari: [0, 7, 12],
      sansagari: [0, 5, 10]
    };

    const tuningIntervals = intervals[tuning] || intervals.honchoshi;
    return tuningIntervals.map((interval) => firstStringMidi + interval);
  }

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToDisplayName(midi) {
    const noteIndex = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const sharp = NOTE_NAMES_SHARP[noteIndex];
    const flat = NOTE_NAMES_FLAT[noteIndex];
    return {
      main: sharp === flat ? sharp : `${sharp} / ${flat}`,
      octave
    };
  }

  function updateTargetDisplay() {
    const targets = getTargetMidiNotes();
    const selectedIndex = Math.max(0, Math.min(2, Number(stringSelect.value) - 1));
    const midi = targets[selectedIndex];
    const name = midiToDisplayName(midi);
    const frequency = midiToFrequency(midi);

    targetNote.textContent = `${name.main}${name.octave}`;
    targetFrequency.textContent = `${frequency.toFixed(2)} Hz`;
  }

  function frequencyToMidi(frequency) {
    return 69 + 12 * Math.log2(frequency / 440);
  }

  function autoCorrelate(buffer, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);

    if (rms < 0.012) {
      return -1;
    }

    let bestOffset = -1;
    let bestCorrelation = 0;
    const maxSamples = Math.floor(buffer.length / 2);

    for (let offset = 20; offset < maxSamples; offset += 1) {
      let correlation = 0;
      for (let i = 0; i < maxSamples; i += 1) {
        correlation += Math.abs(buffer[i] - buffer[i + offset]);
      }
      correlation = 1 - correlation / maxSamples;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    if (bestCorrelation < 0.86 || bestOffset <= 0) {
      return -1;
    }

    return sampleRate / bestOffset;
  }

  function updateMeter(frequency) {
    const exactMidi = frequencyToMidi(frequency);
    const nearestMidi = Math.round(exactMidi);
    const cents = (exactMidi - nearestMidi) * 100;
    const name = midiToDisplayName(nearestMidi);

    frequencyValue.textContent = frequency.toFixed(1);
    detectedNote.textContent = name.main;
    octaveValue.textContent = String(name.octave);
    centValue.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(1)} cent`;

    const clampedCents = Math.max(-50, Math.min(50, cents));
    const rotation = clampedCents;
    needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;

    if (Math.abs(cents) <= 5) {
      guideText.textContent = "ぴったりです！";
      guideText.style.color = "#caffbf";
    } else if (cents < 0) {
      guideText.textContent = Math.abs(cents) <= 15 ? "あと少し上げる" : "音を上げる";
      guideText.style.color = "#8bc9ff";
    } else {
      guideText.textContent = cents <= 15 ? "あと少し下げる" : "音を下げる";
      guideText.style.color = "#ff9188";
    }
  }

  function resetDisplay(message = "開始ボタンを押してください") {
    frequencyValue.textContent = "--.-";
    detectedNote.textContent = "--";
    octaveValue.textContent = "";
    guideText.textContent = message;
    guideText.style.color = "";
    centValue.textContent = "-- cent";
    needle.style.transform = "translateX(-50%) rotate(-50deg)";
  }

  function analyse() {
    if (!running || !analyser || !audioBuffer || !audioContext) {
      return;
    }

    analyser.getFloatTimeDomainData(audioBuffer);
    const pitch = autoCorrelate(audioBuffer, audioContext.sampleRate);

    if (pitch > 40 && pitch < 1200) {
      updateMeter(pitch);
      statusText.textContent = "";
    } else {
      guideText.textContent = "糸をもう一度鳴らしてください";
      guideText.style.color = "";
    }

    animationFrameId = window.requestAnimationFrame(analyse);
  }

  async function startTuner() {
    if (running) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      statusText.textContent = "このブラウザはマイク入力に対応していません。";
      return;
    }

    try {
      statusText.textContent = "マイクの使用許可を確認しています…";

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      audioContext = new AudioContext();
      await audioContext.resume();

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.15;

      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      audioBuffer = new Float32Array(analyser.fftSize);
      running = true;
      startButton.disabled = true;
      stopButton.disabled = false;
      statusText.textContent = "";
      guideText.textContent = "糸を鳴らしてください";
      animationFrameId = window.requestAnimationFrame(analyse);
    } catch (error) {
      console.error(error);
      statusText.textContent =
        "マイクを開始できませんでした。ブラウザのマイク許可を確認してください。";
      await stopTuner();
    }
  }

  async function stopTuner() {
    running = false;

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }

    if (audioContext && audioContext.state !== "closed") {
      try {
        await audioContext.close();
      } catch (error) {
        console.error("AudioContextの終了に失敗しました。", error);
      }
    }

    audioContext = null;
    analyser = null;
    audioBuffer = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    resetDisplay();
  }

  [baseStringSelect, tuningSelect, stringSelect].forEach((element) => {
    element.addEventListener("change", updateTargetDisplay);
  });

  startButton.addEventListener("click", startTuner);
  stopButton.addEventListener("click", stopTuner);

  helpButton.addEventListener("click", () => helpDialog.showModal());
  closeHelpButton.addEventListener("click", () => helpDialog.close());

  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) {
      helpDialog.close();
    }
  });

  window.addEventListener("pagehide", () => {
    void stopTuner();
  });

  updateTargetDisplay();
  resetDisplay();
})();
