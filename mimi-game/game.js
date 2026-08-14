(async () => {
  "use strict";

  const TOTAL = 10;
  const CLEAR_SCORE = 8;
  const STORAGE_KEY = "shian-ear-progress-v3";

  const TUNINGS = {
    hon: { label: "本調子" },
    niage: { label: "二上り" },
    sansage: { label: "三下り" }
  };

  const TUNING_LEVELS = {
    easy: { label: "簡単", honMin: 6, honMax: 6, autoLoop: true },
    normal: { label: "普通", honMin: 1, honMax: 8, autoLoop: true },
    hard: { label: "難しい", honMin: 1, honMax: 12, autoLoop: false }
  };

  const COUNT_LEVELS = {
    easy:   { label: "簡単", count: 3, consecutive: false },
    normal: { label: "普通", count: 5, consecutive: false },
    hard:   { label: "難しい", count: 3, consecutive: true },
    master: { label: "達人", count: 4, consecutive: true }
  };

  const MATCH_LEVELS = {
    practice: {
      label: "練習",
      time: 60,
      passCents: 30,
      cents: [-200, -150, -120, -100, 100, 120, 150, 200]
    },
    easy: {
      label: "簡単",
      time: 60,
      passCents: 20,
      cents: [-120, -100, -80, -60, 60, 80, 100, 120]
    },
    normal: {
      label: "普通",
      time: 40,
      passCents: 12,
      cents: [-60, -50, -40, -30, 30, 40, 50, 60]
    },
    hard: {
      label: "難しい",
      time: 30,
      passCents: 7,
      cents: [-40, -30, -20, -10, 10, 20, 30, 40]
    }
  };

  const LEVELS = [
    { level: 1, name: "初心者", min: 0 },
    { level: 2, name: "見習い", min: 20 },
    { level: 3, name: "中級", min: 50 },
    { level: 4, name: "名人", min: 90 },
    { level: 5, name: "達人", min: 140 }
  ];

  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];

  const engine = window.ShianAudioEngine;
  let master;

  try {
    master = await window.ShianTuningMasterReady;
  } catch (error) {
    document.body.innerHTML =
      `<p class="load-error">調弦データを読み込めませんでした。<br>${escapeHtml(error?.message || "")}</p>`;
    return;
  }

  if (!engine || !master) {
    document.body.innerHTML =
      '<p class="load-error">先生音源を利用するための共通データが見つかりません。</p>';
    return;
  }

  let progress = loadProgress();
  let tuning = {};
  let countGame = {};
  let match = {};
  let lastReplay = null;

  let playbackGeneration = 0;
  let tuningLoopTimer = 0;
  let countPlaybackToken = 0;
  let countAnswerLoopTimer = 0;
  let matchTimer = 0;
  let compareTimer = 0;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadProgress() {
    const fallback = {
      correct: 0,
      cleared: {},
      countMasterUnlocked: false
    };

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return fallback;

      return {
        correct: Number.isFinite(saved.correct) ? Math.max(0, saved.correct) : 0,
        cleared: saved.cleared && typeof saved.cleared === "object" ? saved.cleared : {},
        countMasterUnlocked: Boolean(saved.countMasterUnlocked)
      };
    } catch {
      return fallback;
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // 保存が使えない環境でもゲームは継続可能
    }
  }

  function currentLevel() {
    return [...LEVELS].reverse().find((level) => progress.correct >= level.min) || LEVELS[0];
  }

  function isCertified() {
    return Boolean(
      progress.cleared["tuning-hard"] &&
      progress.cleared["count-master"] &&
      progress.cleared["match-hard"]
    );
  }

  function updateProgressUI() {
    const level = currentLevel();
    const index = LEVELS.findIndex((item) => item.level === level.level);
    const next = LEVELS[index + 1];

    $("ear-level-label").textContent = `Lv.${level.level} ${level.name}`;

    if (!next) {
      $("level-progress-fill").style.width = "100%";
      $("level-progress-text").textContent = `累計 ${progress.correct}問正解・最高レベル達成`;
    } else {
      const range = next.min - level.min;
      const earned = progress.correct - level.min;
      $("level-progress-fill").style.width = `${Math.max(0, Math.min(100, earned / range * 100))}%`;
      $("level-progress-text").textContent =
        `累計 ${progress.correct}問正解／次のレベルまであと${next.min - progress.correct}問`;
    }

    $("certification-banner").classList.toggle("hidden", !isCertified());
    updateCountUnlockUI();
  }

  function updateCountUnlockUI() {
    $("count-master-button").classList.toggle("hidden", !progress.countMasterUnlocked);

    $("count-lock-note").textContent = progress.countMasterUnlocked
      ? "達人モードが解放されています。"
      : "難しいをクリアすると、達人への道が開きます。";
  }

  function recordResult(key, score) {
    progress.correct += score;

    if (score >= CLEAR_SCORE) {
      progress.cleared[key] = true;
    }

    let unlock = "";

    if (key === "count-hard" && score >= CLEAR_SCORE && !progress.countMasterUnlocked) {
      progress.countMasterUnlocked = true;
      unlock = "🎉 達人モードが解放されました！";
    }

    saveProgress();
    updateProgressUI();
    return unlock;
  }

  function stopAll() {
    // await中の自動再生処理も含めて無効化する。
    playbackGeneration += 1;

    clearTimeout(tuningLoopTimer);
    tuningLoopTimer = 0;

    countPlaybackToken += 1;
    clearTimeout(countAnswerLoopTimer);
    countAnswerLoopTimer = 0;

    clearInterval(matchTimer);
    matchTimer = 0;

    clearInterval(compareTimer);
    compareTimer = 0;

    // 音声はフェード待ちせず即時停止。
    engine.stopAll(0);
  }

  function show(id) {
    stopAll();
    screens.forEach((screen) => {
      screen.classList.toggle("active", screen.id === id);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function randomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function setShami(prefix, name) {
    const element = $(`${prefix}-shami`);
    if (element) element.src = `./images/shami_${name}.png`;
  }

  function setMessage(prefix, text, shami = "listening") {
    const element = $(`${prefix}-message`);
    if (element) element.textContent = text;
    setShami(prefix, shami);
  }

  async function playFrequency(frequency, options = {}) {
    return engine.playFrequency(frequency, {
      volume: 1,
      ...options
    });
  }

  async function playHonNumber(hon, options = {}) {
    // teacher-1to12-octave.wav の前半1〜12音は、一の糸の1〜12本に対応。
    // engine.play() は再生時間（秒）を返すため、順次再生の待機時間に利用できる。
    return engine.play(hon, {
      volume: 1,
      ...options
    });
  }

  // ---------- ① 調子を当てる ----------

  function tuningStats() {
    $("tuning-question").textContent = `${tuning.question} / ${TOTAL}`;
    $("tuning-score").textContent = String(tuning.score);
    $("tuning-streak").textContent = String(tuning.streak);
  }

  function startTuning(levelKey) {
    const level = TUNING_LEVELS[levelKey];
    if (!level) return;

    lastReplay = () => startTuning(levelKey);

    tuning = {
      levelKey,
      level,
      question: 1,
      score: 0,
      streak: 0,
      best: 0,
      answered: false
    };

    $("tuning-difficulty-badge").textContent = level.label;
    show("screen-tuning-game");
    newTuningQuestion();
  }

  function newTuningQuestion() {
    clearTimeout(tuningLoopTimer);
    engine.stopAll();

    tuning.key = randomItem(Object.keys(TUNINGS));
    tuning.hon = randomInt(tuning.level.honMin, tuning.level.honMax);
    tuning.answered = false;

    document.querySelectorAll("[data-tuning-answer]").forEach((button) => {
      button.disabled = false;
      button.classList.remove("correct", "wrong");
    });

    $("next-tuning").classList.add("hidden");
    $("tuning-hon-display").textContent = `${tuning.hon}本`;

    tuningStats();

    if (tuning.level.autoLoop) {
      startTuningLoop();
    } else {
      setMessage("tuning", "♪ 三本の糸を聴く を押して答えてね。");
    }
  }

  async function playTuningOnce(generation = playbackGeneration) {
    if (generation !== playbackGeneration) return;

    engine.stopAll(0);
    const entry = master.get(tuning.hon, tuning.key);

    for (let i = 0; i < entry.frequencies.length; i += 1) {
      if (generation !== playbackGeneration || tuning.answered) return;

      try {
        const voice = await playFrequency(entry.frequencies[i], { exclusive: true });

        if (generation !== playbackGeneration || tuning.answered) {
          voice?.stop?.();
          return;
        }

        // その音が最後まで鳴り終わってから次へ進む。
        if (voice?.ended) {
          await voice.ended;
        } else if (Number.isFinite(voice?.duration)) {
          await wait(voice.duration * 1000);
        } else {
          await wait(1000);
        }

        if (generation !== playbackGeneration || tuning.answered) return;

        if (i < entry.frequencies.length - 1) {
          await wait(800);
          if (generation !== playbackGeneration || tuning.answered) return;
        }
      } catch (error) {
        if (generation !== playbackGeneration) return;
        setMessage("tuning", error.message || "音を再生できませんでした。", "timeup");
        return;
      }
    }
  }

  function startTuningLoop() {
    clearTimeout(tuningLoopTimer);

    const generation = playbackGeneration;

    const cycle = async () => {
      if (
        generation !== playbackGeneration ||
        tuning.answered ||
        !tuning.level.autoLoop
      ) return;

      await playTuningOnce(generation);

      if (
        generation !== playbackGeneration ||
        tuning.answered ||
        !tuning.level.autoLoop
      ) return;

      tuningLoopTimer = window.setTimeout(cycle, 2200);
    };

    setMessage("tuning", "問題音をゆっくり繰り返し再生しています。");
    cycle();
  }

  function answerTuning(answer) {
    if (tuning.answered) return;

    tuning.answered = true;
    clearTimeout(tuningLoopTimer);
    engine.stopAll();

    const correct = answer === tuning.key;

    document.querySelectorAll("[data-tuning-answer]").forEach((button) => {
      button.disabled = true;
      if (button.dataset.tuningAnswer === tuning.key) button.classList.add("correct");
      if (button.dataset.tuningAnswer === answer && !correct) button.classList.add("wrong");
    });

    if (correct) {
      tuning.score += 1;
      tuning.streak += 1;
      tuning.best = Math.max(tuning.best, tuning.streak);

      if (tuning.streak >= 3) {
        setMessage("tuning", `${tuning.streak}問連続正解！すごい！`, "streak");
      } else {
        setMessage("tuning", "正解！よく聴き分けられたね♪", "correct");
      }
    } else {
      tuning.streak = 0;
      setMessage("tuning", `おしい！正解は「${TUNINGS[tuning.key].label}」だよ。`, "thinking");
      playTuningOnce();
    }

    tuningStats();
    $("next-tuning").classList.remove("hidden");
    $("next-tuning").textContent =
      tuning.question >= TOTAL ? "結果を見る" : "次の問題へ";
  }

  function nextTuning() {
    if (tuning.question >= TOTAL) {
      finishGame(
        `調子を当てる・${tuning.level.label}`,
        `tuning-${tuning.levelKey}`,
        tuning.score,
        tuning.best
      );
      return;
    }

    tuning.question += 1;
    newTuningQuestion();
  }

  // ---------- ② 何本か当てる ----------

  function countStats() {
    $("count-question").textContent = `${countGame.question} / ${TOTAL}`;
    $("count-score").textContent = String(countGame.score);
    $("count-streak").textContent = String(countGame.streak);
  }

  function createCountSet(level) {
    if (level.consecutive) {
      const start = randomInt(1, 12 - level.count + 1);
      return Array.from({ length: level.count }, (_, index) => start + index);
    }

    return shuffle(Array.from({ length: 12 }, (_, index) => index + 1))
      .slice(0, level.count);
  }

  async function startCount(levelKey) {
    const level = COUNT_LEVELS[levelKey];
    if (!level) return;

    if (levelKey === "master" && !progress.countMasterUnlocked) return;

    // スマホブラウザの自動再生制限対策。
    // 難易度ボタンを押した瞬間（ユーザー操作中）にAudioContextを起動しておく。
    try {
      await engine.resume();
      await engine.load();
    } catch (error) {
      window.alert(error?.message || "先生音源を読み込めませんでした。");
      return;
    }

    lastReplay = () => startCount(levelKey);

    countGame = {
      levelKey,
      level,
      question: 1,
      score: 0,
      streak: 0,
      best: 0,
      answered: false,
      playing: false
    };

    $("count-difficulty-badge").textContent = level.label;
    show("screen-count-game");
    newCountQuestion();
  }

  function newCountQuestion() {
    engine.stopAll();
    countPlaybackToken += 1;

    countGame.notes = createCountSet(countGame.level);
    countGame.targetIndex = randomInt(0, countGame.notes.length - 1);
    countGame.targetHon = countGame.notes[countGame.targetIndex];
    countGame.answered = false;
    countGame.playing = false;
    clearTimeout(countAnswerLoopTimer);
    countAnswerLoopTimer = 0;

    $("count-prompt").textContent = `${countGame.targetHon}本は、どれ？`;
    const answerPlayButton = $("play-count-answer");
    answerPlayButton.classList.add("hidden");
    answerPlayButton.hidden = true;
    answerPlayButton.style.display = "none";
    $("next-count").classList.add("hidden");

    buildCountLabels(false);
    buildCountAnswerButtons();
    buildCountHintKeyboard();

    countStats();

    const countGuideMessage =
      countGame.levelKey === "easy" || countGame.levelKey === "normal"
        ? "音が自動で順番に流れます。よく聴いて答えてね。\nドレミの鍵盤がヒントだよ♪"
        : "音が自動で順番に流れます。よく聴いて答えてね。";

    setMessage("count", countGuideMessage);

    // AudioContext は難易度選択時に起動済み。
    // 描画が見えてから A→B→C… を自動再生する。
    window.setTimeout(() => {
      if (!countGame.answered && !countGame.playing) {
        playCountSequence();
      }
    }, 250);
  }

  function labelName(index) {
    return String.fromCharCode(65 + index);
  }

  const COUNT_HINT_NOTES = {
    1: { latin: "A",  kana: "ラ",    black: false },
    2: { latin: "A♯", kana: "ラ♯",   black: true  },
    3: { latin: "B",  kana: "シ",    black: false },
    4: { latin: "C",  kana: "ド",    black: false },
    5: { latin: "C♯", kana: "ド♯",   black: true  },
    6: { latin: "D",  kana: "レ",    black: false },
    7: { latin: "D♯", kana: "レ♯",   black: true  },
    8: { latin: "E",  kana: "ミ",    black: false },
    9: { latin: "F",  kana: "ファ",  black: false },
    10:{ latin: "F♯", kana: "ファ♯", black: true  },
    11:{ latin: "G",  kana: "ソ",    black: false },
    12:{ latin: "G♯", kana: "ソ♯",   black: true  }
  };

  function buildCountHintKeyboard() {
    const hint = $("count-hint");
    const keyboard = $("count-hint-keyboard");

    const showHint =
      countGame.levelKey === "easy" ||
      countGame.levelKey === "normal";

    hint.classList.toggle("hidden", !showHint);
    keyboard.replaceChildren();

    if (!showHint) return;

    for (let hon = 1; hon <= 12; hon += 1) {
      const info = COUNT_HINT_NOTES[hon];
      const key = document.createElement("div");

      key.className =
        `count-hint-key ${info.black ? "black" : "white"}`;

      if (hon === countGame.targetHon) {
        key.classList.add("target");
      }

      const latin = document.createElement("span");
      latin.className = "latin";
      latin.textContent = info.latin;

      const kana = document.createElement("span");
      kana.className = "kana";
      kana.textContent = info.kana;

      const number = document.createElement("strong");
      number.textContent = `${hon}本`;

      key.append(latin, kana, number);
      keyboard.appendChild(key);
    }
  }


  function buildCountLabels(revealed = false) {
    const container = $("count-sound-labels");
    container.style.gridTemplateColumns = `repeat(${countGame.notes.length}, 1fr)`;
    container.replaceChildren();

    countGame.notes.forEach((hon, index) => {
      const label = document.createElement("div");
      label.className = "sound-label";
      label.dataset.index = String(index);

      const main = document.createElement("strong");
      main.textContent = labelName(index);
      label.appendChild(main);

      if (revealed) {
        label.classList.add("revealed");
        const value = document.createElement("span");
        value.className = "note-value";
        value.textContent = `${hon}本`;
        label.appendChild(value);
      }

      container.appendChild(label);
    });
  }

  function buildCountAnswerButtons() {
    const container = $("count-answer-buttons");
    container.style.gridTemplateColumns = `repeat(${Math.min(countGame.notes.length, 5)}, 1fr)`;
    container.replaceChildren();

    countGame.notes.forEach((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "count-answer-button";
      button.textContent = labelName(index);
      button.dataset.index = String(index);
      button.addEventListener("click", () => answerCount(index));
      container.appendChild(button);
    });
  }

  async function playCountSequence() {
    // 回答後も「もう一度聴く」で正解の並びを確認できる。
    // 再生中の二重押しだけを防止する。
    if (countGame.playing) return;

    countGame.playing = true;
    const token = ++countPlaybackToken;
    const labels = [...$("count-sound-labels").querySelectorAll(".sound-label")];

    $("play-count-sequence").disabled = true;
    $("play-count-sequence").textContent = "♪ 再生中…";

    try {
      for (let index = 0; index < countGame.notes.length; index += 1) {
        if (token !== countPlaybackToken) return;

        labels.forEach((label, i) => {
          label.classList.toggle("playing", i === index);
        });

        // A→B→C…を必ず1音ずつ最後まで再生する。
        const durationSeconds = await playHonNumber(countGame.notes[index], {
          exclusive: true
        });

        if (token !== countPlaybackToken) return;

        const waitMs = Number.isFinite(durationSeconds)
          ? Math.max(700, durationSeconds * 1000 + 220)
          : 1000;

        await wait(waitMs);
      }
    } catch (error) {
      setMessage(
        "count",
        error?.message || "音を再生できませんでした。",
        "timeup"
      );
    } finally {
      labels.forEach((label) => label.classList.remove("playing"));
      countGame.playing = false;
      $("play-count-sequence").disabled = false;
      $("play-count-sequence").textContent = "♪ もう一度聴く";
    }
  }

  async function playCountCorrectLoop() {
    clearTimeout(countAnswerLoopTimer);
    countAnswerLoopTimer = 0;

    if (!countGame.answered) return;

    const token = ++countPlaybackToken;
    const labels = [...$("count-sound-labels").querySelectorAll(".sound-label")];

    const cycle = async () => {
      if (!countGame.answered || token !== countPlaybackToken) return;

      labels.forEach((label, index) => {
        label.classList.toggle("playing", index === countGame.targetIndex);
      });

      try {
        const duration = await playHonNumber(countGame.targetHon, { exclusive: true });
        if (!countGame.answered || token !== countPlaybackToken) return;

        const waitMs = Number.isFinite(duration)
          ? Math.max(750, duration * 1000 + 350)
          : 1100;

        countAnswerLoopTimer = window.setTimeout(cycle, waitMs);
      } catch (error) {
        labels.forEach((label) => label.classList.remove("playing"));
        setMessage("count", error?.message || "音を再生できませんでした。", "timeup");
      }
    };

    cycle();
  }

  function answerCount(index) {
    if (countGame.answered || countGame.playing) return;

    countGame.answered = true;
    countPlaybackToken += 1;
    engine.stopAll();

    const correct = index === countGame.targetIndex;
    const buttons = [...$("count-answer-buttons").querySelectorAll(".count-answer-button")];

    buttons.forEach((button, buttonIndex) => {
      button.disabled = true;
      if (buttonIndex === countGame.targetIndex) button.classList.add("correct");
      if (buttonIndex === index && !correct) button.classList.add("wrong");
    });

    buildCountLabels(true);

    const answerPlayButton = $("play-count-answer");
    answerPlayButton.textContent = `♪ ${countGame.targetHon}本の音だけを聴く`;
    answerPlayButton.classList.remove("hidden");
    answerPlayButton.hidden = false;
    answerPlayButton.style.display = "inline-flex";

    if (correct) {
      countGame.score += 1;
      countGame.streak += 1;
      countGame.best = Math.max(countGame.best, countGame.streak);

      if (countGame.streak >= 3) {
        setMessage(
          "count",
          `${countGame.streak}問連続正解！${countGame.targetHon}本は${labelName(countGame.targetIndex)}だよ♪`,
          "streak"
        );
      } else {
        setMessage(
          "count",
          `正解！${countGame.targetHon}本は${labelName(countGame.targetIndex)}だよ♪`,
          "correct"
        );
      }
    } else {
      countGame.streak = 0;
      setMessage(
        "count",
        `おしい！${countGame.targetHon}本は${labelName(countGame.targetIndex)}だったよ。`,
        "retry"
      );
    }

    countStats();
    $("next-count").classList.remove("hidden");
    $("next-count").textContent =
      countGame.question >= TOTAL ? "結果を見る" : "次の問題へ";
  }

  function nextCount() {
    clearTimeout(countAnswerLoopTimer);
    countAnswerLoopTimer = 0;
    countPlaybackToken += 1;
    engine.stopAll();

    if (countGame.question >= TOTAL) {
      finishGame(
        `何本か当てる・${countGame.level.label}`,
        `count-${countGame.levelKey}`,
        countGame.score,
        countGame.best
      );
      return;
    }

    countGame.question += 1;
    newCountQuestion();
  }

  // ---------- ③ 音を合わせる ----------

  function matchStats() {
    $("match-question").textContent = `${match.question} / ${TOTAL}`;
    $("match-score").textContent = String(match.score);
    $("match-streak").textContent = String(match.streak);
  }

  function adjustedFrequency() {
    return match.frequency * Math.pow(2, match.cents / 1200);
  }

  function startMatch(levelKey) {
    const level = MATCH_LEVELS[levelKey];
    if (!level) return;

    lastReplay = () => startMatch(levelKey);

    match = {
      levelKey,
      level,
      question: 1,
      score: 0,
      streak: 0,
      best: 0,
      answered: false,
      comparing: false
    };

    $("match-difficulty-badge").textContent = level.label;
    show("screen-match-game");
    newMatchQuestion();
  }

  function newMatchQuestion() {
    clearInterval(matchTimer);
    clearInterval(compareTimer);
    engine.stopAll();

    const entry = randomItem(master.entries);

    match.frequency = randomItem(entry.frequencies);
    match.cents = randomItem(match.level.cents);
    match.time = match.level.time;
    match.answered = false;
    match.comparing = false;
    match.reviewMode = false;
    match.finalPlayerFrequency = null;
    match.finalCents = null;

    $("submit-match").classList.remove("hidden");
    $("submit-match").disabled = false;
    $("next-match").classList.add("hidden");
    $("match-hz-result").classList.add("hidden");

    document.querySelectorAll("[data-shift]").forEach((button) => {
      button.disabled = false;
    });

    matchStats();
    updateMatchTimer();
    setMessage(
      "match",
      `${match.level.label}：二つの音を聴き比べて近づけよう。\n合格幅は ±${match.level.passCents}cent だよ。`
    );

    startMatchTimer();
  }

  function startMatchTimer() {
    clearInterval(matchTimer);

    matchTimer = window.setInterval(() => {
      match.time -= 1;
      updateMatchTimer();

      if (match.time <= 0) {
        finishMatch(false, true);
      }
    }, 1000);
  }

  function updateMatchTimer() {
    $("match-timer").textContent = String(match.time);
    $("match-timer-fill").style.width =
      `${Math.max(0, Math.min(100, match.time / match.level.time * 100))}%`;
  }

  async function playMatchTarget() {
    try {
      await playFrequency(match.frequency, { exclusive: true });
    } catch (error) {
      setMessage("match", error.message || "音を再生できませんでした。", "timeup");
    }
  }

  async function playMatchPlayer() {
    try {
      await playFrequency(adjustedFrequency(), { exclusive: true });
    } catch (error) {
      setMessage("match", error.message || "音を再生できませんでした。", "timeup");
    }
  }

  async function playMatchCompareOnce() {
    engine.stopAll();

    try {
      const playerFrequency = adjustedFrequency();
      const targetVoice = await playFrequency(match.frequency, { exclusive: true });

      if (targetVoice?.ended) {
        await targetVoice.ended;
      } else if (Number.isFinite(targetVoice?.duration)) {
        await wait(targetVoice.duration * 1000);
      } else {
        await wait(1000);
      }

      await wait(350);
      await playFrequency(playerFrequency, { exclusive: true });
    } catch (error) {
      setMessage("match", error.message || "音を再生できませんでした。", "timeup");
    }
  }

  function updateMatchHzResult() {
    if (!$("match-hz-result")) return;

    const cents = match.cents;
    const sign = cents > 0 ? "+" : "";

    $("match-target-hz").textContent = `${match.frequency.toFixed(1)} Hz`;
    $("match-player-hz").textContent = `${adjustedFrequency().toFixed(1)} Hz`;
    $("match-cent-diff").textContent = `${sign}${cents.toFixed(0)} cent`;
    $("match-pass-note").textContent =
      `${match.level.label}では ±${match.level.passCents}cent 以内を合格にしています。` +
      (match.levelKey === "practice"
        ? " ぴったり同じ音でなくても合格になります。"
        : "");
    $("match-hz-result").classList.remove("hidden");
  }

  function shiftMatch(cents) {
    if (match.answered && !match.reviewMode) return;

    match.cents = Math.max(-240, Math.min(240, match.cents + cents));

    if (match.reviewMode) {
      updateMatchHzResult();

      const diff = match.cents;
      if (Math.abs(diff) <= match.level.passCents) {
        setMessage("match", "合格範囲まで近づいたよ。音をよく確認してみよう。", "listening");
      } else if (diff < 0) {
        setMessage("match", "まだ少し低いよ。少し上げて音を確認してみよう。", "listening");
      } else {
        setMessage("match", "まだ少し高いよ。少し下げて音を確認してみよう。", "listening");
      }
    } else {
      setMessage("match", cents < 0 ? "自分の音を下げました。" : "自分の音を上げました.");
    }

    playMatchPlayer();
  }

  function submitMatch() {
    if (match.answered) return;

    const correct = Math.abs(match.cents) <= match.level.passCents;
    finishMatch(correct, false);
  }

  function finishMatch(correct, timeout) {
    if (match.answered) return;

    match.finalPlayerFrequency = adjustedFrequency();
    match.finalCents = match.cents;
    match.answered = true;

    clearInterval(matchTimer);
    clearInterval(compareTimer);
    engine.stopAll();

    $("submit-match").classList.add("hidden");
    $("next-match").classList.remove("hidden");
    $("next-match").textContent =
      match.question >= TOTAL ? "結果を見る" : "次の問題へ";

    updateMatchHzResult();

    if (correct) {
      match.reviewMode = false;
      match.score += 1;
      match.streak += 1;
      match.best = Math.max(match.best, match.streak);

      document.querySelectorAll("[data-shift]").forEach((button) => {
        button.disabled = true;
      });

      if (match.streak >= 3) {
        setMessage(
          "match",
          `${match.streak}問連続合格！\n${match.level.label}の合格範囲に入ったよ♪`,
          "streak"
        );
      } else {
        setMessage(
          "match",
          `合格！\n${match.level.label}の合格範囲に入ったよ♪`,
          "correct"
        );
      }
    } else {
      match.reviewMode = true;
      match.streak = 0;

      // 不正解として成績は確定。ただし上げ下げ操作は復習用に残す。
      document.querySelectorAll("[data-shift]").forEach((button) => {
        button.disabled = false;
      });

      const currentHz = match.finalPlayerFrequency.toFixed(1);

      if (timeout) {
        setMessage(
          "match",
          `時間切れ！${currentHz}Hzだったよ。\n基準音とあなたの音を聴き比べて、音を確認してみよう。`,
          "timeup"
        );
      } else if (match.finalCents < 0) {
        setMessage(
          "match",
          `${currentHz}Hz　低かったよ\n少し上げて音を確認してみよう`,
          "thinking"
        );
      } else {
        setMessage(
          "match",
          `${currentHz}Hz　高かったよ\n少し下げて音を確認してみよう`,
          "thinking"
        );
      }
    }

    matchStats();
  }

  function nextMatch() {
    if (match.question >= TOTAL) {
      finishGame(
        `音を合わせる・${match.level.label}`,
        `match-${match.levelKey}`,
        match.score,
        match.best
      );
      return;
    }

    match.question += 1;
    newMatchQuestion();
  }

  // ---------- 結果・認定 ----------

  function finishGame(title, key, score, best) {
    const unlock = recordResult(key, score);

    $("result-course").textContent = title;
    $("result-score").textContent = `${score} / ${TOTAL}`;
    $("result-best-streak").textContent = `${best}問`;

    if (score === TOTAL) {
      $("result-shami").src = "./images/shami_master.png";
      $("result-message").textContent = "全問正解！すごい！";
    } else if (score >= CLEAR_SCORE) {
      $("result-shami").src = "./images/shami_finish.png";
      $("result-message").textContent = `クリア！${score}問正解できたよ♪`;
    } else if (score >= 5) {
      $("result-shami").src = "./images/shami_love.png";
      $("result-message").textContent =
        `あと少し！クリアは${CLEAR_SCORE}問正解からだよ。`;
    } else {
      $("result-shami").src = "./images/shami_ready.png";
      $("result-message").textContent =
        "もう一度挑戦して、少しずつ耳を育てよう♪";
    }

    $("unlock-message").textContent = unlock;
    $("unlock-message").classList.toggle("hidden", !unlock);

    $("result-certification").classList.toggle("hidden", !isCertified());

    show("screen-result");
  }

  // ---------- 共通イベント ----------

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");

    if (actionButton) {
      const action = actionButton.dataset.action;

      if (action === "menu") {
        updateProgressUI();
        show("screen-menu");
      } else if (action === "open-tuning-select") {
        show("screen-tuning-select");
      } else if (action === "open-count-select") {
        updateCountUnlockUI();
        show("screen-count-select");
      } else if (action === "open-match-select") {
        show("screen-match-select");
      }
    }

    const tuningStart = event.target.closest("[data-start-tuning]");
    if (tuningStart) startTuning(tuningStart.dataset.startTuning);

    const countStart = event.target.closest("[data-start-count]");
    if (countStart) startCount(countStart.dataset.startCount);

    const matchStart = event.target.closest("[data-start-match]");
    if (matchStart) startMatch(matchStart.dataset.startMatch);

    const tuningAnswer = event.target.closest("[data-tuning-answer]");
    if (tuningAnswer) answerTuning(tuningAnswer.dataset.tuningAnswer);

    const shiftButton = event.target.closest("[data-shift]");
    if (shiftButton) shiftMatch(Number(shiftButton.dataset.shift));
  });

  $("play-tuning").addEventListener("click", () => {
    playTuningOnce();
  });

  $("next-tuning").addEventListener("click", nextTuning);

  $("play-count-sequence").addEventListener("click", playCountSequence);
  $("play-count-answer").addEventListener("click", playCountCorrectLoop);
  $("next-count").addEventListener("click", nextCount);

  $("play-match-target").addEventListener("click", playMatchTarget);
  $("play-match-player").addEventListener("click", playMatchPlayer);
  $("play-match-compare").addEventListener("click", playMatchCompareOnce);
  $("submit-match").addEventListener("click", submitMatch);
  $("next-match").addEventListener("click", nextMatch);

  $("replay-button").addEventListener("click", () => {
    if (typeof lastReplay === "function") lastReplay();
  });

  $("open-certificate-top").addEventListener("click", () => {
    show("screen-certificate");
  });

  $("open-certificate-result").addEventListener("click", () => {
    show("screen-certificate");
  });


  // ---------- 本数のおさらい モーダル ----------

  const REVIEW_NOTE_LABELS = {
    1: "ラ",
    2: "ラ♯",
    3: "シ",
    4: "ド",
    5: "ド♯",
    6: "レ",
    7: "レ♯",
    8: "ミ",
    9: "ファ",
    10: "ファ♯",
    11: "ソ",
    12: "ソ♯"
  };

  let reviewPlaybackToken = 0;
  let reviewLoopTimer = 0;
  let reviewMode = "idle";
  let reviewCurrentHon = null;

  function reviewKeys() {
    return [...document.querySelectorAll("[data-review-hon]")];
  }

  function reviewNumberButtons() {
    return [...document.querySelectorAll(".review-number-button")];
  }

  function clearReviewPlaying() {
    reviewKeys().forEach((key) => key.classList.remove("playing"));
    reviewNumberButtons().forEach((button) => button.classList.remove("playing"));
  }

  function markReviewPlaying(hon) {
    clearReviewPlaying();

    document
      .querySelector(`.review-key[data-review-hon="${hon}"]`)
      ?.classList.add("playing");

    document
      .querySelector(`.review-number-button[data-hon="${hon}"]`)
      ?.classList.add("playing");
  }

  function stopReviewPlayback(message = "停止しました。") {
    reviewPlaybackToken += 1;
    clearTimeout(reviewLoopTimer);
    reviewLoopTimer = 0;
    reviewMode = "idle";
    reviewCurrentHon = null;
    engine.stopAll();
    clearReviewPlaying();
    $("review-play-all").disabled = false;
    $("review-status").textContent = message;
  }

  async function ensureReviewAudio() {
    await engine.resume();
    await engine.load();
  }

  async function startReviewSingleLoop(hon) {
    stopReviewPlayback("");
    await ensureReviewAudio();

    const token = ++reviewPlaybackToken;
    reviewMode = "single";
    reviewCurrentHon = hon;

    const cycle = async () => {
      if (token !== reviewPlaybackToken || reviewMode !== "single") return;

      markReviewPlaying(hon);
      $("review-status").textContent =
        `${hon}本（${REVIEW_NOTE_LABELS[hon]}）を繰り返し再生しています。`;

      try {
        const duration = await engine.play(hon, {
          exclusive: true,
          volume: 1
        });

        if (token !== reviewPlaybackToken || reviewMode !== "single") return;

        const waitMs = Number.isFinite(duration)
          ? Math.max(750, duration * 1000 + 350)
          : 1100;

        reviewLoopTimer = window.setTimeout(cycle, waitMs);
      } catch (error) {
        stopReviewPlayback(error?.message || "音を再生できませんでした。");
      }
    };

    cycle();
  }

  async function startReviewAll() {
    stopReviewPlayback("");
    await ensureReviewAudio();

    const token = ++reviewPlaybackToken;
    reviewMode = "all";
    $("review-play-all").disabled = true;

    try {
      for (let hon = 1; hon <= 12; hon += 1) {
        if (token !== reviewPlaybackToken || reviewMode !== "all") return;

        markReviewPlaying(hon);
        $("review-status").textContent =
          `${hon}本（${REVIEW_NOTE_LABELS[hon]}）を再生中`;

        const duration = await engine.play(hon, {
          exclusive: true,
          volume: 1
        });

        const waitMs = Number.isFinite(duration)
          ? Math.max(750, duration * 1000 + 260)
          : 1000;

        await wait(waitMs);
      }

      if (token === reviewPlaybackToken && reviewMode === "all") {
        clearReviewPlaying();
        reviewMode = "idle";
        $("review-play-all").disabled = false;
        $("review-status").textContent = "1本から12本までの連続再生が終わりました。";
      }
    } catch (error) {
      stopReviewPlayback(error?.message || "音を再生できませんでした。");
    }
  }

  function openReviewModal() {
    stopAll();

    $("review-modal").classList.remove("hidden");
    document.body.classList.add("review-open");
    $("review-status").textContent =
      "鍵盤を押すと、その1音を繰り返し再生します。";

    // モーダルを開くタップを音声利用のユーザー操作として使う
    engine.resume().then(() => engine.load()).catch((error) => {
      $("review-status").textContent =
        error?.message || "先生音源を読み込めませんでした。";
    });
  }

  function closeReviewModal() {
    stopReviewPlayback("");
    $("review-modal").classList.add("hidden");
    document.body.classList.remove("review-open");
  }

  function buildReviewNumberButtons() {
    const container = $("review-number-grid");
    container.replaceChildren();

    for (let hon = 1; hon <= 12; hon += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-number-button";
      button.dataset.hon = String(hon);

      const main = document.createElement("span");
      main.textContent = `${hon}本`;

      const sub = document.createElement("small");
      sub.textContent = REVIEW_NOTE_LABELS[hon];

      button.append(main, sub);
      button.addEventListener("click", () => startReviewSingleLoop(hon));
      container.appendChild(button);
    }
  }

  $("open-review-modal").addEventListener("click", openReviewModal);
  $("review-play-all").addEventListener("click", startReviewAll);
  $("review-stop").addEventListener("click", () => stopReviewPlayback());

  document.querySelectorAll("[data-review-close]").forEach((button) => {
    button.addEventListener("click", closeReviewModal);
  });

  reviewKeys().forEach((key) => {
    key.addEventListener("click", () => {
      startReviewSingleLoop(Number(key.dataset.reviewHon));
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("review-modal").classList.contains("hidden")) {
      closeReviewModal();
    }
  });

  buildReviewNumberButtons();


  // ---------- 認定書プレビュー ポップアップ ----------

  function openCertificatePreviewModal() {
    $("certificate-preview-modal").classList.remove("hidden");
    document.body.classList.add("certificate-preview-open");
  }

  function closeCertificatePreviewModal() {
    $("certificate-preview-modal").classList.add("hidden");
    document.body.classList.remove("certificate-preview-open");
  }

  $("open-certificate-preview").addEventListener("click", openCertificatePreviewModal);

  document.querySelectorAll("[data-certificate-preview-close]").forEach((button) => {
    button.addEventListener("click", closeCertificatePreviewModal);
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("certificate-preview-modal").classList.contains("hidden")
    ) {
      closeCertificatePreviewModal();
    }
  });


  // ページを離れたら必ずすべての音を止める。
  window.addEventListener("pagehide", stopAll);
  window.addEventListener("blur", stopAll);

  document.addEventListener("freeze", stopAll);

  window.addEventListener("beforeunload", () => {
    stopAll();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAll();
    }
  });

  // アプリ内リンクで別ページへ移動する場合も、遷移直前に停止する。
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || link.target === "_blank") return;

    stopAll();
  }, true);

  updateProgressUI();
})();
