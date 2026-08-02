(async () => {
  "use strict";

  const TOTAL = 10;
  const LIMIT = 20;
  const MATCH_TOLERANCE_CENTS = 5;
  const TUNING_LOOP_MS = 4300;
  const COMPARE_LOOP_MS = 2300;
  const TUNINGS = {
    honchoshi: { label: "本調子", master: "hon" },
    niagari: { label: "二上り", master: "niage" },
    sansagari: { label: "三下り", master: "sansage" }
  };
  const DIFFICULTIES = {
    easy: { label: "かんたん", cents: [-200, -150, -100, 100, 150, 200] },
    normal: { label: "ふつう", cents: [-50, -40, -30, -20, 20, 30, 40, 50] },
    hard: { label: "むずかしい", cents: [-40, -30, -20, -10, 10, 20, 30, 40] }
  };
  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];
  const tuningButtons = [...document.querySelectorAll("[data-tuning]")];
  const shiftButtons = [...document.querySelectorAll("[data-shift]")];
  const engine = window.ShianAudioEngine;
  let master;
  try {
    master = await window.ShianTuningMasterReady;
  } catch (error) {
    document.body.innerHTML = `<p class="load-error">${error.message || "調弦データを読み込めませんでした。"}</p>`;
    return;
  }

  let progress;
  try {
    progress = JSON.parse(localStorage.getItem("shian-ear-progress-v2") || '{"correct":0,"cleared":{}}');
  } catch (_) {
    progress = { correct: 0, cleared: {} };
  }
  let lastMode = "basic";
  let difficulty = "normal";
  let tuning = {};
  let match = {};
  let timer = 0;
  let tuningLoopTimer = 0;
  let compareLoopTimer = 0;

  function stopTuningLoop() {
    clearTimeout(tuningLoopTimer);
    tuningLoopTimer = 0;
    engine.stopAll();
  }
  function stopCompareLoop() {
    clearInterval(compareLoopTimer);
    compareLoopTimer = 0;
    match.comparing = false;
    engine.stopAll();
  }
  function stopAllPlayback() {
    stopTuningLoop();
    stopCompareLoop();
  }
  function show(id) {
    stopAllPlayback();
    clearInterval(timer);
    screens.forEach((screen) => screen.classList.toggle("active", screen.id === id));
    scrollTo({ top: 0, behavior: "smooth" });
  }
  function image(prefix, name) { $(prefix + "-shami").src = `images/shami_${name}.png`; }
  function message(prefix, text, name = "listening") {
    $(prefix + "-message").textContent = text;
    image(prefix, name);
  }
  function random(array) { return array[Math.floor(Math.random() * array.length)]; }
  function adjustedFrequency() { return match.frequency * Math.pow(2, match.cents / 1200); }
  function formatHz(value) { return `${Number(value).toFixed(1)}Hz`; }
  async function playFrequency(frequency, cents = 0, delay = 0, exclusive = true) {
    return engine.playFrequency(frequency, {
      playbackRate: Math.pow(2, cents / 1200), delay, exclusive, volume: 1.125
    });
  }

  function playTuningSequence() {
    engine.stopAll();
    const entry = master.get(tuning.hon, TUNINGS[tuning.key].master);
    entry.frequencies.forEach((frequency, index) => {
      playFrequency(frequency, 0, index * 1.05, index === 0).catch((error) => message("tuning", error.message, "timeup"));
    });
  }
  function startTuningLoop() {
    stopTuningLoop();
    const cycle = () => {
      if (tuning.answered) return;
      playTuningSequence();
      tuningLoopTimer = window.setTimeout(cycle, TUNING_LOOP_MS);
    };
    cycle();
    message("tuning", "問題音を繰り返し再生しています");
  }
  function playTarget(exclusive = true) { return playFrequency(match.frequency, 0, 0, exclusive); }
  function playPlayer(exclusive = true) { return playFrequency(match.frequency, match.cents, 0, exclusive); }
  function playComparePair() {
    engine.stopAll();
    playTarget(true).catch((error) => message("match", error.message, "timeup"));
    playPlayer(false).catch((error) => message("match", error.message, "timeup"));
  }
  function startCompareLoop() {
    stopCompareLoop();
    match.comparing = true;
    playComparePair();
    compareLoopTimer = window.setInterval(playComparePair, COMPARE_LOOP_MS);
    message("match", "基準音と自分の音を繰り返し再生しています");
  }

  function updateProgress(mode, score) {
    progress.correct = (progress.correct || 0) + score;
    if (score >= 5) progress.cleared[mode] = true;
    localStorage.setItem("shian-ear-progress-v2", JSON.stringify(progress));
    const level = Math.min(5, Math.floor(progress.correct / 20) + 1);
    $("ear-level-label").textContent = `Lv.${level}`;
    $("level-progress-fill").style.width = `${level === 5 ? 100 : (progress.correct % 20) * 5}%`;
    $("level-progress-text").textContent = `累計 ${progress.correct} 問正解`;
    $("certification-banner").classList.toggle("hidden", !["basic", "advanced", "match"].every((key) => progress.cleared[key]));
  }
  function tuningStats() {
    $("tuning-question").textContent = `${tuning.question} / ${TOTAL}`;
    $("tuning-score").textContent = tuning.score;
    $("tuning-streak").textContent = tuning.streak;
  }
  function createHonButtons() {
    $("hon-buttons").replaceChildren(...Array.from({ length: 8 }, (_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hon-button";
      button.textContent = `${index + 1}本`;
      button.addEventListener("click", () => {
        if (tuning.answered) return;
        tuning.answerHon = index + 1;
        document.querySelectorAll(".hon-button").forEach((item) => item.classList.toggle("selected", item === button));
        message("tuning", "続けて調子を押すと回答します");
      });
      return button;
    }));
  }
  function startTuning(mode) {
    lastMode = mode;
    tuning = { mode, question: 1, score: 0, streak: 0, best: 0 };
    $("tuning-course-badge").textContent = mode === "basic" ? "基本" : "応用";
    $("hon-answer-area").classList.toggle("hidden", mode === "basic");
    createHonButtons();
    show("screen-tuning-game");
    nextTuning();
  }
  function nextTuning() {
    stopTuningLoop();
    if (tuning.answered && tuning.question >= TOTAL) return result(tuning.mode, tuning.score, tuning.best);
    if (tuning.answered) tuning.question++;
    Object.assign(tuning, {
      key: random(Object.keys(TUNINGS)), hon: Math.floor(Math.random() * 8) + 1,
      answerKey: null, answerHon: null, answered: false
    });
    tuningButtons.forEach((button) => { button.disabled = false; button.classList.remove("selected"); });
    document.querySelectorAll(".hon-button").forEach((button) => { button.disabled = false; button.classList.remove("selected"); });
    $("hon-display").classList.toggle("hidden", tuning.mode === "advanced");
    $("hon-display").textContent = `一の糸：${tuning.hon}本`;
    $("next-tuning").classList.add("hidden");
    tuningStats();
    message("tuning", tuning.mode === "advanced" ? "本数を選び、調子を押して回答してください" : "再生して調子を押してください");
  }
  function answerTuning(answerKey) {
    if (tuning.answered) return;
    if (tuning.mode === "advanced" && !tuning.answerHon) {
      message("tuning", "先に一の糸の本数を選んでください", "thinking");
      return;
    }
    tuning.answerKey = answerKey;
    tuning.answered = true;
    stopTuningLoop();
    const correct = tuning.answerKey === tuning.key && (tuning.mode === "basic" || tuning.answerHon === tuning.hon);
    tuningButtons.forEach((button) => { button.disabled = true; button.classList.toggle("selected", button.dataset.tuning === answerKey); });
    document.querySelectorAll(".hon-button").forEach((button) => { button.disabled = true; });
    if (correct) {
      tuning.score++;
      tuning.streak++;
      tuning.best = Math.max(tuning.best, tuning.streak);
      message("tuning", "正解！よく聴き分けられたね", "correct");
    } else {
      tuning.streak = 0;
      message("tuning", `正解は ${TUNINGS[tuning.key].label}・${tuning.hon}本`, "thinking");
      playTuningSequence();
    }
    tuningStats();
    $("next-tuning").classList.remove("hidden");
    $("next-tuning").textContent = tuning.question >= TOTAL ? "結果を見る" : "次の問題へ";
  }

  function matchStats() {
    $("match-question").textContent = `${match.question} / ${TOTAL}`;
    $("match-score").textContent = match.score;
    $("match-streak").textContent = match.streak;
  }
  function updateHint() {
    $("hint-target-hz").textContent = formatHz(match.frequency);
    $("hint-player-hz").textContent = formatHz(adjustedFrequency());
  }
  function hideHint() { $("match-hint").classList.add("hidden"); }
  function showHint() {
    updateHint();
    $("match-hint").classList.remove("hidden");
  }
  function startMatch() {
    lastMode = "match";
    match = { question: 1, score: 0, streak: 0, best: 0 };
    show("screen-match-game");
    nextMatch();
  }
  function startTimer() {
    clearInterval(timer);
    timer = window.setInterval(() => {
      match.time--;
      updateTimer();
      if (match.time <= 0) answerMatch(true);
    }, 1000);
  }
  function nextMatch() {
    stopCompareLoop();
    clearInterval(timer);
    if (match.answered && match.question >= TOTAL) return result("match", match.score, match.best);
    if (match.answered) match.question++;
    const entry = random(master.entries);
    Object.assign(match, {
      frequency: random(entry.frequencies), cents: random(DIFFICULTIES[difficulty].cents),
      answered: false, retry: false, comparing: false, time: LIMIT
    });
    hideHint();
    $("submit-match").classList.remove("hidden");
    $("submit-match").disabled = false;
    $("next-match").classList.add("hidden");
    shiftButtons.forEach((button) => { button.disabled = false; });
    matchStats();
    updateTimer();
    message("match", `${DIFFICULTIES[difficulty].label}：聴き比べるを押して近づけよう`);
    startTimer();
  }
  function updateTimer() {
    $("timer").textContent = match.time;
    $("timer-bar-fill").style.width = `${Math.max(0, match.time / LIMIT * 100)}%`;
  }
  function shift(cents) {
    if (match.answered) return;
    match.cents = Math.max(-200, Math.min(200, match.cents + cents));
    if (match.retry) updateHint();
    if (match.comparing) startCompareLoop();
    else playPlayer().catch((error) => message("match", error.message, "timeup"));
    message("match", cents < 0 ? "音を下げました" : "音を上げました");
  }
  function enterRetry() {
    clearInterval(timer);
    match.retry = true;
    match.streak = 0;
    match.time = LIMIT;
    showHint();
    matchStats();
    updateTimer();
    message("match", "時間切れ。\n\nヒントを表示して\n再チャレンジするよ！", "hint");
    if (match.comparing) startCompareLoop();
    startTimer();
  }
  function finishMatchAnswer(correct) {
    clearInterval(timer);
    match.answered = true;
    stopCompareLoop();
    shiftButtons.forEach((button) => { button.disabled = true; });
    if (correct) {
      if (!match.retry) {
        match.score++;
        match.streak++;
        match.best = Math.max(match.best, match.streak);
        message("match", "正解！ぴったり合ったよ", "correct");
      } else {
        message("match", "再チャレンジ成功！次の問題へ進もう", "correct");
      }
    } else {
      match.streak = 0;
      showHint();
      message("match", "惜しい！ヒントの音を確認してみよう", "thinking");
    }
    matchStats();
    $("submit-match").classList.add("hidden");
    $("next-match").classList.remove("hidden");
    $("next-match").textContent = match.question >= TOTAL ? "結果を見る" : "次の問題へ";
  }
  function answerMatch(timeout = false) {
    if (match.answered) return;
    if (timeout) {
      enterRetry();
      return;
    }
    const correct = Math.abs(match.cents) <= MATCH_TOLERANCE_CENTS;
    if (match.retry && !correct) {
      showHint();
      message("match", "まだ少し違います。ヒントを見て続けよう", "thinking");
      return;
    }
    finishMatchAnswer(correct);
  }
  function result(mode, score, best) {
    updateProgress(mode, score);
    $("result-course").textContent = mode === "match" ? "音を合わせる" : `調子を当てる・${mode === "basic" ? "基本" : "応用"}`;
    $("result-score").textContent = `${score} / ${TOTAL}`;
    $("result-best-streak").textContent = `${best}問`;
    $("result-message").textContent = score >= 8 ? "すごい！耳がしっかり育っています" : score >= 5 ? "よく頑張りました！" : "もう一度挑戦して耳を育てよう";
    $("result-shami").src = `images/shami_${score === 10 ? "master" : score >= 5 ? "finish" : "ready"}.png`;
    show("screen-result");
  }

  tuningButtons.forEach((button) => button.addEventListener("click", () => answerTuning(button.dataset.tuning)));
  shiftButtons.forEach((button) => button.addEventListener("click", () => shift(Number(button.dataset.shift))));
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "menu") show("screen-menu");
    if (action === "open-tuning" || action === "tuning-select") show("screen-tuning-select");
    if (action === "start-basic") startTuning("basic");
    if (action === "start-advanced") startTuning("advanced");
    if (action === "start-match") startMatch();
  });
  document.querySelectorAll("[data-difficulty]").forEach((button) => button.addEventListener("click", () => {
    difficulty = button.dataset.difficulty;
    document.querySelectorAll("[data-difficulty]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
  }));
  $("play-tuning").addEventListener("click", startTuningLoop);
  $("next-tuning").addEventListener("click", nextTuning);
  $("play-target").addEventListener("click", () => { stopCompareLoop(); playTarget().catch((error) => message("match", error.message, "timeup")); });
  $("play-player").addEventListener("click", () => { stopCompareLoop(); playPlayer().catch((error) => message("match", error.message, "timeup")); });
  $("play-compare").addEventListener("click", startCompareLoop);
  $("submit-match").addEventListener("click", () => answerMatch(false));
  $("next-match").addEventListener("click", nextMatch);
  $("replay-button").addEventListener("click", () => lastMode === "match" ? startMatch() : startTuning(lastMode));
  addEventListener("pagehide", stopAllPlayback);
  updateProgress("noop", 0);
})();
