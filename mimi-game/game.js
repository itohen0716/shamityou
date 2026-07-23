(() => {
  "use strict";
  const TOTAL = 10, LIMIT = 20;
  const TUNINGS = {
    honchoshi: { label:"本調子", offsets:[0,5,12] },
    niagari: { label:"二上り", offsets:[0,7,12] },
    sansagari: { label:"三下り", offsets:[0,5,10] }
  };
  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];
  const tuningButtons = [...document.querySelectorAll("[data-tuning]")];
  const shiftButtons = [...document.querySelectorAll("[data-shift]")];
  const engine = window.ShianAudioEngine;
  const progress = JSON.parse(localStorage.getItem("shian-ear-progress-v2") || '{"correct":0,"cleared":{}}');
  let lastMode = "basic";
  let tuning = {}, match = {}, timer;

  function show(id) {
    engine.stopAll();
    clearInterval(timer);
    screens.forEach((screen) => screen.classList.toggle("active", screen.id === id));
    scrollTo({ top:0, behavior:"smooth" });
  }
  function image(prefix, name) { $(prefix + "-shami").src = `images/shami_${name}.png`; }
  function message(prefix, text, name = "listening") { $(prefix + "-message").textContent = text; image(prefix, name); }
  function random(array) { return array[Math.floor(Math.random() * array.length)]; }
  function segmentForSemitone(semitone) {
    const wrapped = ((semitone % 12) + 12) % 12;
    const octave = semitone >= 12 ? 12 : 0;
    return wrapped + 1 + octave;
  }
  async function playSemitone(semitone, cents = 0, delay = 0, exclusive = true) {
    const note = segmentForSemitone(semitone);
    return engine.playSegment(note, { playbackRate: Math.pow(2, cents / 1200), delay, exclusive });
  }
  async function playTuning(key, hon) {
    try {
      engine.stopAll();
      const base = 12 - hon;
      TUNINGS[key].offsets.forEach((offset, index) => playSemitone(base + offset, 0, index * 1.05, index === 0));
    } catch (error) { message("tuning", error.message, "timeup"); }
  }
  function playTarget(exclusive = true) { return playSemitone(match.note, 0, 0, exclusive); }
  function playPlayer(delay = 0, exclusive = true) { return playSemitone(match.note, match.cents, delay, exclusive); }
  function compare() { engine.stopAll(); playTarget(true); playPlayer(1.15, false); }

  function updateProgress(mode, score) {
    progress.correct = (progress.correct || 0) + score;
    if (score >= 5) progress.cleared[mode] = true;
    localStorage.setItem("shian-ear-progress-v2", JSON.stringify(progress));
    const level = Math.min(5, Math.floor(progress.correct / 20) + 1);
    $("ear-level-label").textContent = `Lv.${level}`;
    $("level-progress-fill").style.width = `${level === 5 ? 100 : progress.correct % 20 * 5}%`;
    $("level-progress-text").textContent = `累計 ${progress.correct} 問正解`;
    $("certification-banner").classList.toggle("hidden", !["basic","advanced","match"].every((key) => progress.cleared[key]));
  }
  function tuningStats() {
    $("tuning-question").textContent = `${tuning.question} / ${TOTAL}`;
    $("tuning-score").textContent = tuning.score;
    $("tuning-streak").textContent = tuning.streak;
  }
  function createHonButtons() {
    $("hon-buttons").replaceChildren(...Array.from({length:8}, (_, index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "hon-button"; button.textContent = `${index + 1}本`;
      button.addEventListener("click", () => {
        if (tuning.answered) return;
        tuning.answerHon = index + 1;
        document.querySelectorAll(".hon-button").forEach((item) => item.classList.toggle("selected", item === button));
        validateTuning();
      });
      return button;
    }));
  }
  function validateTuning() {
    $("submit-tuning").disabled = !(tuning.answerKey && (tuning.mode === "basic" || tuning.answerHon));
  }
  function startTuning(mode) {
    lastMode = mode;
    tuning = { mode, question:1, score:0, streak:0, best:0 };
    $("tuning-course-badge").textContent = mode === "basic" ? "基本" : "応用";
    $("hon-answer-area").classList.toggle("hidden", mode === "basic");
    createHonButtons(); show("screen-tuning-game"); nextTuning();
  }
  function nextTuning() {
    if (tuning.answered && tuning.question >= TOTAL) return result(tuning.mode, tuning.score, tuning.best);
    if (tuning.answered) tuning.question++;
    Object.assign(tuning, { key:random(Object.keys(TUNINGS)), hon:Math.floor(Math.random()*8)+1, answerKey:null, answerHon:null, answered:false });
    tuningButtons.forEach((button) => { button.disabled=false; button.classList.remove("selected"); });
    document.querySelectorAll(".hon-button").forEach((button) => { button.disabled=false; button.classList.remove("selected"); });
    $("hon-display").classList.toggle("hidden", tuning.mode === "advanced");
    $("hon-display").textContent = `一の糸：${tuning.hon}本`;
    $("submit-tuning").classList.remove("hidden"); $("submit-tuning").disabled=true;
    $("next-tuning").classList.add("hidden");
    tuningStats(); message("tuning", "再生して調子を選んでください");
  }
  function answerTuning() {
    if (tuning.answered) return;
    tuning.answered = true;
    const correct = tuning.answerKey === tuning.key && (tuning.mode === "basic" || tuning.answerHon === tuning.hon);
    tuningButtons.forEach((b) => b.disabled=true);
    document.querySelectorAll(".hon-button").forEach((b) => b.disabled=true);
    if (correct) {
      tuning.score++; tuning.streak++; tuning.best=Math.max(tuning.best,tuning.streak);
      message("tuning", "正解！よく聴き分けられたね", "correct");
    } else {
      tuning.streak=0;
      message("tuning", `正解は ${TUNINGS[tuning.key].label}・${tuning.hon}本`, "thinking");
      playTuning(tuning.key, tuning.hon);
    }
    tuningStats(); $("submit-tuning").classList.add("hidden"); $("next-tuning").classList.remove("hidden");
    $("next-tuning").textContent = tuning.question >= TOTAL ? "結果を見る" : "次の問題へ";
  }
  function matchStats() {
    $("match-question").textContent=`${match.question} / ${TOTAL}`;
    $("match-score").textContent=match.score; $("match-streak").textContent=match.streak;
  }
  function startMatch() {
    lastMode="match"; match={question:1,score:0,streak:0,best:0}; show("screen-match-game"); nextMatch();
  }
  function nextMatch() {
    if (match.answered && match.question >= TOTAL) return result("match",match.score,match.best);
    if (match.answered) match.question++;
    Object.assign(match,{note:Math.floor(Math.random()*16),cents:random([-40,-30,-20,-10,10,20,30,40]),answered:false,time:LIMIT});
    $("submit-match").classList.remove("hidden"); $("submit-match").disabled=false; $("next-match").classList.add("hidden");
    shiftButtons.forEach((button)=>button.disabled=false); matchStats(); updateTimer();
    message("match","二つの音を聴き比べて近づけよう"); setTimeout(compare,250);
    timer=setInterval(()=>{ match.time--; updateTimer(); if(match.time<=0) answerMatch(true); },1000);
  }
  function updateTimer() {
    $("timer").textContent=match.time; $("timer-bar-fill").style.width=`${Math.max(0,match.time/LIMIT*100)}%`;
  }
  function shift(cents) {
    if(match.answered)return;
    match.cents=Math.max(-100,Math.min(100,match.cents+cents)); playPlayer();
    message("match",cents<0?"音を下げました":"音を上げました");
  }
  function answerMatch(timeout=false) {
    if(match.answered)return;
    clearInterval(timer); match.answered=true; shiftButtons.forEach((b)=>b.disabled=true);
    if(!timeout && Math.abs(match.cents)<=5) {
      match.score++; match.streak++; match.best=Math.max(match.best,match.streak);
      message("match","正解！ぴったり合ったよ","correct");
    } else {
      match.streak=0; message("match",timeout?"時間切れ。正しい音を聴いてみよう":"惜しい！正しい音を聴いてみよう","thinking");
      match.cents=0; compare();
    }
    matchStats(); $("submit-match").classList.add("hidden"); $("next-match").classList.remove("hidden");
    $("next-match").textContent=match.question>=TOTAL?"結果を見る":"次の問題へ";
  }
  function result(mode,score,best) {
    updateProgress(mode,score); $("result-course").textContent=mode==="match"?"音を合わせる":`調子を当てる・${mode==="basic"?"基本":"応用"}`;
    $("result-score").textContent=`${score} / ${TOTAL}`; $("result-best-streak").textContent=`${best}問`;
    $("result-message").textContent=score>=8?"すごい！耳がしっかり育っています":score>=5?"よく頑張りました！":"もう一度挑戦して耳を育てよう";
    $("result-shami").src=`images/shami_${score===10?"master":score>=5?"finish":"ready"}.png`;
    show("screen-result");
  }

  tuningButtons.forEach((button)=>button.addEventListener("click",()=>{if(tuning.answered)return;tuning.answerKey=button.dataset.tuning;tuningButtons.forEach((b)=>b.classList.toggle("selected",b===button));validateTuning();}));
  shiftButtons.forEach((button)=>button.addEventListener("click",()=>shift(Number(button.dataset.shift))));
  document.addEventListener("click",(event)=>{
    const action=event.target.closest("[data-action]")?.dataset.action;
    if(action==="menu")show("screen-menu");
    if(action==="open-tuning"||action==="tuning-select")show("screen-tuning-select");
    if(action==="start-basic")startTuning("basic");
    if(action==="start-advanced")startTuning("advanced");
    if(action==="start-match")startMatch();
  });
  $("play-tuning").addEventListener("click",()=>playTuning(tuning.key,tuning.hon));
  $("submit-tuning").addEventListener("click",answerTuning); $("next-tuning").addEventListener("click",nextTuning);
  $("play-target").addEventListener("click",()=>playTarget()); $("play-player").addEventListener("click",()=>playPlayer());
  $("play-compare").addEventListener("click",compare); $("submit-match").addEventListener("click",()=>answerMatch(false)); $("next-match").addEventListener("click",nextMatch);
  $("replay-button").addEventListener("click",()=>lastMode==="match"?startMatch():startTuning(lastMode));
  addEventListener("pagehide",()=>engine.stopAll());
  updateProgress("noop",0);
})();
