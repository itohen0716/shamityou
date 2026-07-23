(() => {
  "use strict";

  const TOTAL_QUESTIONS = 10;
  const MATCH_TIME_LIMIT = 20;

  // 仮設定：1本をC3として、1本上がるごとに半音上げます。
  // 実際のアプリの本数対応表に合わせる場合は、ここだけ変更してください。
  const HON_BASE_MIDI = 48;

  const TUNINGS = {
    honchoshi: { label: "本調子", intervals: [0, 5, 12] },
    niagari: { label: "二上り", intervals: [0, 7, 12] },
    sansagari: { label: "三下り", intervals: [0, 5, 10] }
  };

  const PROGRESS_KEY = "shian-ear-progress-v1";
  const LEVELS = [
    { level: 1, name: "初心者", minCorrect: 0 },
    { level: 2, name: "見習い", minCorrect: 10 },
    { level: 3, name: "中級", minCorrect: 30 },
    { level: 4, name: "名人", minCorrect: 60 },
    { level: 5, name: "達人", minCorrect: 100 }
  ];
  function loadProgress(){const fallback={totalCorrect:0,cleared:{"tuning-basic":false,"tuning-advanced":false,"match":false}};try{const saved=JSON.parse(localStorage.getItem(PROGRESS_KEY)||"null");if(!saved||typeof saved!=="object")return fallback;return{totalCorrect:Number.isFinite(saved.totalCorrect)?Math.max(0,saved.totalCorrect):0,cleared:{"tuning-basic":Boolean(saved.cleared?.["tuning-basic"]),"tuning-advanced":Boolean(saved.cleared?.["tuning-advanced"]),"match":Boolean(saved.cleared?.match)}}}catch{return fallback}}
  const progress=loadProgress();
  function saveProgress(){try{localStorage.setItem(PROGRESS_KEY,JSON.stringify(progress))}catch{}}
  function getCurrentLevel(){return[...LEVELS].reverse().find(item=>progress.totalCorrect>=item.minCorrect)||LEVELS[0]}
  function isCertified(){return Object.values(progress.cleared).every(Boolean)}
  function updateProgressUI(){const current=getCurrentLevel();const currentIndex=LEVELS.findIndex(item=>item.level===current.level);const next=LEVELS[currentIndex+1];document.getElementById("ear-level-label").textContent=`Lv.${current.level} ${current.name}`;const fill=document.getElementById("level-progress-fill");const text=document.getElementById("level-progress-text");if(!next){fill.style.width="100%";text.textContent=`累計 ${progress.totalCorrect}問正解・最高レベル達成`}else{const range=next.minCorrect-current.minCorrect;const earned=progress.totalCorrect-current.minCorrect;fill.style.width=`${Math.max(0,Math.min(100,(earned/range)*100))}%`;text.textContent=`次のレベルまで、あと${Math.max(0,next.minCorrect-progress.totalCorrect)}問正解`}document.getElementById("certification-banner").classList.toggle("hidden",!isCertified())}
  function recordGameResult(mode,score){progress.totalCorrect+=score;if(score>=5)progress.cleared[mode]=true;saveProgress();updateProgressUI()}

  const screens = [...document.querySelectorAll(".screen")];
  const tuningButtons = [...document.querySelectorAll("[data-tuning]")];
  const shiftButtons = [...document.querySelectorAll("[data-shift]")];

  let audioContext = null;
  let lastMode = "tuning-basic";

  const state = {
    tuning: {
      mode: "basic",
      question: 1,
      score: 0,
      streak: 0,
      bestStreak: 0,
      answerTuning: null,
      answerHon: null,
      currentTuning: null,
      currentHon: 6,
      answered: false
    },
    match: {
      question: 1,
      score: 0,
      streak: 0,
      bestStreak: 0,
      targetMidi: 60,
      offsetCents: 0,
      answered: false,
      timerId: null,
      timeLeft: MATCH_TIME_LIMIT
    }
  };

  function showScreen(id) {
    screens.forEach((screen) => {
      screen.classList.toggle("active", screen.id === id);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function ensureAudio() {
    try {
      if (
        window.parent &&
        window.parent !== window &&
        window.parent.ShianAudioEngine
      ) {
        audioContext = window.parent.ShianAudioEngine.getContext();
        if (audioContext.state === "suspended") {
          window.parent.ShianAudioEngine.resume();
        }
        return audioContext;
      }
    } catch (_) {
      // 単独表示時は、このページ内のAudioContextを使用します。
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("このブラウザでは音声再生に対応していません。");
    }
    if (!audioContext) {
      audioContext = new AudioCtx();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return audioContext;
  }

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function playPluckedTone(frequency, startDelay = 0, duration = 0.9) {
    const ctx = ensureAudio();
    const start = ctx.currentTime + startDelay;

    const gain = ctx.createGain();
    const oscillatorA = ctx.createOscillator();
    const oscillatorB = ctx.createOscillator();

    oscillatorA.type = "triangle";
    oscillatorB.type = "sine";
    oscillatorA.frequency.setValueAtTime(frequency, start);
    oscillatorB.frequency.setValueAtTime(frequency * 2, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.55, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillatorA.connect(gain);
    oscillatorB.connect(gain);
    gain.connect(ctx.destination);

    oscillatorA.start(start);
    oscillatorB.start(start);
    oscillatorA.stop(start + duration + 0.05);
    oscillatorB.stop(start + duration + 0.05);
  }

  function playTuningSequence(tuningKey, hon) {
    try {
      const rootMidi = HON_BASE_MIDI + (hon - 1);
      const intervals = TUNINGS[tuningKey].intervals;
      intervals.forEach((interval, index) => {
        playPluckedTone(midiToFrequency(rootMidi + interval), index * 1.0, 0.82);
      });
    } catch (error) {
      setTuningMessage(error.message, "timeup");
    }
  }

  function playTargetTone() {
    try {
      playPluckedTone(midiToFrequency(state.match.targetMidi), 0, 1.0);
    } catch (error) {
      setMatchMessage(error.message, "timeup");
    }
  }

  function playPlayerTone(delay = 0) {
    try {
      const frequency = midiToFrequency(state.match.targetMidi) * Math.pow(2, state.match.offsetCents / 1200);
      playPluckedTone(frequency, delay, 1.0);
    } catch (error) {
      setMatchMessage(error.message, "timeup");
    }
  }

  function playCompare() {
    playTargetTone();
    playPlayerTone(1.15);
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function randomHon() {
    return Math.floor(Math.random() * 8) + 1;
  }

  function setShami(elementId, name) {
    const element = document.getElementById(elementId);
    element.src = `images/shami_${name}.png`;
  }

  function setTuningMessage(text, shamiName = "listening") {
    document.getElementById("tuning-message").textContent = text;
    setShami("tuning-shami", shamiName);
  }

  function setMatchMessage(text, shamiName = "listening") {
    document.getElementById("match-message").textContent = text;
    setShami("match-shami", shamiName);
  }

  function updateTuningStats() {
    document.getElementById("tuning-question").textContent =
      `${state.tuning.question} / ${TOTAL_QUESTIONS}`;
    document.getElementById("tuning-score").textContent = String(state.tuning.score);
    document.getElementById("tuning-streak").textContent = String(state.tuning.streak);
  }

  function updateMatchStats() {
    document.getElementById("match-question").textContent =
      `${state.match.question} / ${TOTAL_QUESTIONS}`;
    document.getElementById("match-score").textContent = String(state.match.score);
    document.getElementById("match-streak").textContent = String(state.match.streak);
  }

  function createHonButtons() {
    const container = document.getElementById("hon-buttons");
    container.replaceChildren();

    for (let hon = 1; hon <= 8; hon += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hon-button";
      button.textContent = `${hon}本`;
      button.dataset.hon = String(hon);
      button.addEventListener("click", () => selectHon(hon, button));
      container.appendChild(button);
    }
  }

  function clearTuningSelections() {
    state.tuning.answerTuning = null;
    state.tuning.answerHon = null;
    tuningButtons.forEach((button) => button.classList.remove("selected"));
    document.querySelectorAll(".hon-button").forEach((button) => button.classList.remove("selected"));
    document.getElementById("submit-tuning").disabled = true;
  }

  function selectTuning(tuningKey, button) {
    if (state.tuning.answered) return;
    state.tuning.answerTuning = tuningKey;
    tuningButtons.forEach((item) => item.classList.toggle("selected", item === button));
    validateTuningAnswerReady();
  }

  function selectHon(hon, button) {
    if (state.tuning.answered) return;
    state.tuning.answerHon = hon;
    document.querySelectorAll(".hon-button").forEach((item) =>
      item.classList.toggle("selected", item === button)
    );
    validateTuningAnswerReady();
  }

  function validateTuningAnswerReady() {
    const ready =
      Boolean(state.tuning.answerTuning) &&
      (state.tuning.mode === "basic" || Boolean(state.tuning.answerHon));
    document.getElementById("submit-tuning").disabled = !ready;
  }

  function startTuning(mode) {
    lastMode = mode === "basic" ? "tuning-basic" : "tuning-advanced";
    state.tuning = {
      mode,
      question: 1,
      score: 0,
      streak: 0,
      bestStreak: 0,
      answerTuning: null,
      answerHon: null,
      currentTuning: null,
      currentHon: 6,
      answered: false
    };

    document.getElementById("tuning-course-badge").textContent =
      mode === "basic" ? "基本" : "応用";
    document.getElementById("hon-answer-area").classList.toggle("hidden", mode !== "advanced");
    createHonButtons();
    showScreen("screen-tuning-game");
    newTuningQuestion();
  }

  function newTuningQuestion() {
    state.tuning.currentTuning = randomItem(Object.keys(TUNINGS));
    state.tuning.currentHon = randomHon();
    state.tuning.answered = false;
    clearTuningSelections();

    document.getElementById("hon-display").classList.toggle("hidden", state.tuning.mode === "advanced");
    document.getElementById("hon-display").textContent = `一の糸：${state.tuning.currentHon}本`;
    document.getElementById("submit-tuning").classList.remove("hidden");
    document.getElementById("next-tuning").classList.add("hidden");
    tuningButtons.forEach((button) => (button.disabled = false));
    document.querySelectorAll(".hon-button").forEach((button) => (button.disabled = false));

    updateTuningStats();
    setTuningMessage("再生ボタンを押して、3本の糸を聴いてみよう。", "listening");
  }

  function submitTuningAnswer() {
    if (state.tuning.answered) return;

    const tuningCorrect = state.tuning.answerTuning === state.tuning.currentTuning;
    const honCorrect =
      state.tuning.mode === "basic" || state.tuning.answerHon === state.tuning.currentHon;
    const correct = tuningCorrect && honCorrect;

    state.tuning.answered = true;
    tuningButtons.forEach((button) => (button.disabled = true));
    document.querySelectorAll(".hon-button").forEach((button) => (button.disabled = true));

    if (correct) {
      state.tuning.score += 1;
      state.tuning.streak += 1;
      state.tuning.bestStreak = Math.max(state.tuning.bestStreak, state.tuning.streak);

      if (state.tuning.streak >= 3) {
        setTuningMessage(`${state.tuning.streak}問連続正解！耳が育っているよ♪`, "streak");
      } else {
        setTuningMessage("正解！よく聴き分けられたね♪", "correct");
      }
    } else {
      state.tuning.streak = 0;
      const answer = `${TUNINGS[state.tuning.currentTuning].label}・${state.tuning.currentHon}本`;
      setTuningMessage(`おしい！正解は「${answer}」だよ。もう一度聴いてみよう♪`, "thinking");
      playTuningSequence(state.tuning.currentTuning, state.tuning.currentHon);
    }

    updateTuningStats();
    document.getElementById("submit-tuning").classList.add("hidden");
    document.getElementById("next-tuning").classList.remove("hidden");
    document.getElementById("next-tuning").textContent =
      state.tuning.question >= TOTAL_QUESTIONS ? "結果を見る" : "次の問題へ";
  }

  function nextTuningQuestion() {
    if (state.tuning.question >= TOTAL_QUESTIONS) {
      recordGameResult(state.tuning.mode === "basic" ? "tuning-basic" : "tuning-advanced", state.tuning.score);
      showResult(
        state.tuning.mode === "basic" ? "調子を当てる・基本" : "調子を当てる・応用",
        state.tuning.score,
        state.tuning.bestStreak
      );
      return;
    }

    state.tuning.question += 1;
    newTuningQuestion();
  }

  function startMatch() {
    lastMode = "match";
    state.match = {
      question: 1,
      score: 0,
      streak: 0,
      bestStreak: 0,
      targetMidi: 60,
      offsetCents: 0,
      answered: false,
      timerId: null,
      timeLeft: MATCH_TIME_LIMIT
    };
    showScreen("screen-match-game");
    newMatchQuestion();
  }

  function randomStartingOffset() {
    const values = [-40, -35, -30, -25, -20, -15, -10, 10, 15, 20, 25, 30, 35, 40];
    return randomItem(values);
  }

  function newMatchQuestion() {
    clearInterval(state.match.timerId);
    state.match.targetMidi = Math.floor(Math.random() * 16) + 48;
    state.match.offsetCents = randomStartingOffset();
    state.match.answered = false;
    state.match.timeLeft = MATCH_TIME_LIMIT;

    document.getElementById("submit-match").classList.remove("hidden");
    document.getElementById("next-match").classList.add("hidden");
    document.getElementById("submit-match").disabled = false;
    shiftButtons.forEach((button) => (button.disabled = false));

    updateMatchStats();
    updateTimerUI();
    setMatchMessage("基準音と自分の音を聴き比べて、音を近づけよう。", "listening");

    setTimeout(playCompare, 250);
    startTimer();
  }

  function startTimer() {
    clearInterval(state.match.timerId);
    state.match.timerId = window.setInterval(() => {
      state.match.timeLeft -= 1;
      updateTimerUI();

      if (state.match.timeLeft <= 0) {
        clearInterval(state.match.timerId);
        handleMatchTimeUp();
      }
    }, 1000);
  }

  function updateTimerUI() {
    document.getElementById("timer").textContent = String(state.match.timeLeft);
    const percent = Math.max(0, (state.match.timeLeft / MATCH_TIME_LIMIT) * 100);
    document.getElementById("timer-bar-fill").style.width = `${percent}%`;
  }

  function shiftPitch(cents) {
    if (state.match.answered) return;
    state.match.offsetCents = Math.max(-100, Math.min(100, state.match.offsetCents + cents));
    playPlayerTone();
    setMatchMessage(
      cents < 0 ? "自分の音を下げました。聴き比べてみよう。" : "自分の音を上げました。聴き比べてみよう。",
      "listening"
    );
  }

  function submitMatchAnswer(isTimeUp = false) {
    if (state.match.answered) return;

    clearInterval(state.match.timerId);
    state.match.answered = true;
    document.getElementById("submit-match").disabled = true;
    shiftButtons.forEach((button) => (button.disabled = true));

    const difference = Math.abs(state.match.offsetCents);
    const correct = !isTimeUp && difference <= 5;

    if (correct) {
      state.match.score += 1;
      state.match.streak += 1;
      state.match.bestStreak = Math.max(state.match.bestStreak, state.match.streak);

      if (state.match.streak >= 3) {
        setMatchMessage(`${state.match.streak}問連続正解！ぴったり合わせられたね♪`, "streak");
      } else {
        setMatchMessage("正解！音がぴったり合ったよ♪", "correct");
      }
    } else {
      state.match.streak = 0;
      if (isTimeUp) {
        setMatchMessage("時間切れ！正しい音を聴いてみよう。", "timeup");
      } else {
        const direction = state.match.offsetCents > 0 ? "少し高かった" : "少し低かった";
        setMatchMessage(`おしい！自分の音は${direction}よ。正しい音を聴いてみよう。`, "thinking");
      }
      state.match.offsetCents = 0;
      playCompare();
    }

    updateMatchStats();
    document.getElementById("submit-match").classList.add("hidden");
    document.getElementById("next-match").classList.remove("hidden");
    document.getElementById("next-match").textContent =
      state.match.question >= TOTAL_QUESTIONS ? "結果を見る" : "次の問題へ";
  }

  function handleMatchTimeUp() {
    submitMatchAnswer(true);
  }

  function nextMatchQuestion() {
    if (state.match.question >= TOTAL_QUESTIONS) {
      recordGameResult("match", state.match.score);
      showResult("音を合わせる", state.match.score, state.match.bestStreak);
      return;
    }

    state.match.question += 1;
    newMatchQuestion();
  }

  function showResult(courseName, score, bestStreak) {
    clearInterval(state.match.timerId);

    document.getElementById("result-course").textContent = courseName;
    document.getElementById("result-score").textContent = `${score} / ${TOTAL_QUESTIONS}`;
    document.getElementById("result-best-streak").textContent = `${bestStreak}問`;

    const resultShami = document.getElementById("result-shami");
    const resultMessage = document.getElementById("result-message");

    if (score === TOTAL_QUESTIONS) {
      resultShami.src = "images/shami_master.png";
      resultMessage.textContent = "全問正解！耳の名人だね♪";
    } else if (score >= 8) {
      resultShami.src = "images/shami_finish.png";
      resultMessage.textContent = "すごい！しっかり音を聴き分けられているよ♪";
    } else if (score >= 5) {
      resultShami.src = "images/shami_love.png";
      resultMessage.textContent = "よく頑張ったね♪ もう一度遊ぶと、もっと耳が育つよ。";
    } else {
      resultShami.src = "images/shami_ready.png";
      resultMessage.textContent = "ここから上達できるよ。一緒にもう一度挑戦しよう♪";
    }

    document.getElementById("result-certification").classList.toggle("hidden", !isCertified());
    showScreen("screen-result");
  }

  function replayLastMode() {
    if (lastMode === "tuning-basic") {
      startTuning("basic");
    } else if (lastMode === "tuning-advanced") {
      startTuning("advanced");
    } else {
      startMatch();
    }
  }

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    if (action === "menu") {
      clearInterval(state.match.timerId);
      updateProgressUI();
      showScreen("screen-menu");
    } else if (action === "open-tuning") {
      showScreen("screen-tuning-select");
    } else if (action === "tuning-select") {
      showScreen("screen-tuning-select");
    } else if (action === "start-basic") {
      startTuning("basic");
    } else if (action === "start-advanced") {
      startTuning("advanced");
    } else if (action === "start-match") {
      startMatch();
    }
  });

  tuningButtons.forEach((button) => {
    button.addEventListener("click", () => selectTuning(button.dataset.tuning, button));
  });

  shiftButtons.forEach((button) => {
    button.addEventListener("click", () => shiftPitch(Number(button.dataset.shift)));
  });

  document.getElementById("play-tuning").addEventListener("click", () => {
    playTuningSequence(state.tuning.currentTuning, state.tuning.currentHon);
    setTuningMessage("よく聴いて、調子を選んでね。", "listening");
  });

  document.getElementById("submit-tuning").addEventListener("click", submitTuningAnswer);
  document.getElementById("next-tuning").addEventListener("click", nextTuningQuestion);

  document.getElementById("play-target").addEventListener("click", playTargetTone);
  document.getElementById("play-player").addEventListener("click", () => playPlayerTone());
  document.getElementById("play-compare").addEventListener("click", playCompare);
  document.getElementById("submit-match").addEventListener("click", () => submitMatchAnswer(false));
  document.getElementById("next-match").addEventListener("click", nextMatchQuestion);
  document.getElementById("replay-button").addEventListener("click", replayLastMode);

  createHonButtons();
  updateProgressUI();
})();
