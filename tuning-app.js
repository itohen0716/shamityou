(() => {
"use strict";

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const BASE = {1:174.61,2:164.81,3:155.56,4:146.83,5:138.59,6:130.81,7:123.47,8:116.54,9:110,10:103.83,11:98,12:92.5};
const MODES = {
  hon:{label:"本調子", ratios:{ichi:1,ni:4/3,san:2}},
  niage:{label:"二上り",ratios:{ichi:1,ni:3/2,san:2}},
  sansage:{label:"三下り",ratios:{ichi:1,ni:4/3,san:16/9}}
};
const LABELS={ichi:"一の糸",ni:"二の糸",san:"三の糸"};
const ORDER=["ichi","ni","san"];
const SCENES={
  go:"./images/tuning/shami_go.png",
  next2:"./images/tuning/shami_next2.png",
  next3:"./images/tuning/shami_next3.png",
  complete:"./images/tuning/shami_complete.png"
};
const EXPRESSIONS={
  listening:"./images/expressions/shami_listening.png",
  adjust:"./images/expressions/shami_adjust.png",
  ok:"./images/expressions/shami_ok.png",
  retry:"./images/expressions/shami_retry.png"
};

/* お師匠さんの録音内にある24音の開始位置。
   前半12音=1本〜12本、後半12音=その1オクターブ上。 */
const SAMPLE_STARTS=[3.36,6.80,10.24,13.66,17.10,20.52,23.94,27.38,30.80,34.22,37.66,41.08,
44.52,47.94,51.38,54.80,58.24,61.66,65.10,68.52,71.94,75.36,78.80,82.20];

let tuning="hon", practice=null, activeString=null, sequenceIndex=0;
let notes={ichi:BASE[6],ni:BASE[6]*4/3,san:BASE[6]*2};
let audioContext=null, teacherBuffer=null, mediaStream=null, analyser=null, micSource=null;
let loopTimer=null, rafId=null, suppressUntil=0, stableFrames=0, running=false;

const $=id=>document.getElementById(id);
const els={
  count:$("honCount"),summary:$("settingSummary"),hzIchi:$("hzIchi"),hzNi:$("hzNi"),hzSan:$("hzSan"),
  stop:$("stopButton"),mic:$("micState"),needle:$("meterNeedle"),judgement:$("judgement"),
  expression:$("expressionImage"),message:$("shamiMessage"),overlay:$("sceneOverlay"),scene:$("sceneImage")
};

function updateNotes(){
  if(!els.count) return;
  const n=Number(els.count.value), mode=MODES[tuning], base=BASE[n];
  notes={ichi:base,ni:base*mode.ratios.ni,san:base*mode.ratios.san};
  els.summary.textContent=`${n}本・${mode.label}`;
  els.hzIchi.textContent=`${notes.ichi.toFixed(2)} Hz`;
  els.hzNi.textContent=`${notes.ni.toFixed(2)} Hz`;
  els.hzSan.textContent=`${notes.san.toFixed(2)} Hz`;
  localStorage.setItem("shian-count",String(n));
  localStorage.setItem("shian-tuning",tuning);
}
function setExpression(kind,message){
  if(!els.expression) return;
  els.expression.src=EXPRESSIONS[kind];
  els.message.textContent=message;
}
function setJudgement(text,ok=false){
  els.judgement.textContent=text;
  els.judgement.classList.toggle("ok",ok);
}
function setNeedle(cents){
  const clamped=Math.max(-50,Math.min(50,cents));
  els.needle.style.left=`${50+clamped}%`;
}
function setStringButtons(){
  document.querySelectorAll("[data-string]").forEach(btn=>{
    const isActive=btn.dataset.string===activeString;
    btn.classList.toggle("active",isActive);
    btn.disabled=practice==="sequence" && !isActive;
  });
}
async function showScene(key,duration=1800){
  els.scene.src=SCENES[key];
  els.overlay.hidden=false;
  requestAnimationFrame(()=>els.overlay.classList.add("show"));
  await new Promise(r=>setTimeout(r,duration));
  els.overlay.classList.remove("show");
  await new Promise(r=>setTimeout(r,260));
  els.overlay.hidden=true;
}
async function ensureAudio(){
  if(!AudioContextClass) throw new Error("このブラウザは音声機能に対応していません。");
  if(!audioContext) audioContext=new AudioContextClass();
  if(audioContext.state==="suspended") await audioContext.resume();
  if(!teacherBuffer){
    const response=await fetch("./sounds/teacher-1to12-octave.wav");
    if(!response.ok) throw new Error("基準音源を読み込めません。");
    teacherBuffer=await audioContext.decodeAudioData(await response.arrayBuffer());
  }
}
function chooseSample(targetHz){
  const count=Number(els.count.value);
  const candidates=[];
  for(let i=0;i<12;i++){
    candidates.push({index:i,frequency:BASE[i+1]});
    candidates.push({index:i+12,frequency:BASE[i+1]*2});
  }
  let best=candidates[0],bestDistance=Infinity;
  for(const c of candidates){
    const distance=Math.abs(1200*Math.log2(targetHz/c.frequency));
    if(distance<bestDistance){best=c;bestDistance=distance;}
  }
  return {start:SAMPLE_STARTS[best.index],rate:targetHz/best.frequency};
}
async function playTeacherOnce(){
  if(!running || !activeString) return;
  await ensureAudio();
  const target=notes[activeString];
  const sample=chooseSample(target);
  const source=audioContext.createBufferSource();
  const gain=audioContext.createGain();
  source.buffer=teacherBuffer;
  source.playbackRate.value=sample.rate;
  gain.gain.value=.9;
  source.connect(gain).connect(audioContext.destination);
  suppressUntil=performance.now()+1150;
  source.start(0,sample.start,1.35);
}
function startReferenceLoop(){
  stopReferenceLoop();
  playTeacherOnce();
  loopTimer=setInterval(playTeacherOnce,3000);
}
function stopReferenceLoop(){
  if(loopTimer){clearInterval(loopTimer);loopTimer=null;}
}
async function ensureMicrophone(){
  if(mediaStream) return;
  mediaStream=await navigator.mediaDevices.getUserMedia({
    audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}
  });
  await ensureAudio();
  analyser=audioContext.createAnalyser();
  analyser.fftSize=4096;
  micSource=audioContext.createMediaStreamSource(mediaStream);
  micSource.connect(analyser);
}
function startPitchLoop(){
  cancelAnimationFrame(rafId);
  const data=new Float32Array(analyser.fftSize);
  const tick=()=>{
    if(!running){return;}
    analyser.getFloatTimeDomainData(data);
    if(performance.now()<suppressUntil){
      els.mic.textContent="基準音を聴いてください";
      rafId=requestAnimationFrame(tick); return;
    }
    const result=window.ShianPitch.autoCorrelate(data,audioContext.sampleRate);
    if(result.frequency<0 || result.clarity<.35){
      stableFrames=0;
      els.mic.textContent="三味線を弾いてください";
      setJudgement("音を待っています");
      setExpression("listening","一音ずつ、ゆっくり弾いてね");
      rafId=requestAnimationFrame(tick); return;
    }
    const target=notes[activeString];
    let cents=1200*Math.log2(result.frequency/target);
    /* 倍音を基本音と誤認した場合を補正 */
    while(cents>700){cents-=1200;}
    while(cents<-700){cents+=1200;}
    setNeedle(cents);
    els.mic.textContent=`${LABELS[activeString]}を測定中`;

    const abs=Math.abs(cents);
    if(abs<=8){
      stableFrames++;
      setJudgement("ぴったりです！",true);
      setExpression("ok","ぴったりです！");
      if(stableFrames>=20) handleMatched();
    }else{
      stableFrames=0;
      if(cents<-35){setJudgement("もう少し高くしてください");setExpression("adjust","少しずつ上げてみよう");}
      else if(cents<-8){setJudgement("あと少し高くしてください");setExpression("adjust","あと少し♪");}
      else if(cents>35){setJudgement("もう少し低くしてください");setExpression("adjust","少しずつ下げてみよう");}
      else {setJudgement("あと少し低くしてください");setExpression("adjust","あと少し♪");}
    }
    rafId=requestAnimationFrame(tick);
  };
  rafId=requestAnimationFrame(tick);
}
let changing=false;
async function handleMatched(){
  if(changing) return;
  changing=true; stableFrames=0; stopReferenceLoop();
  await new Promise(r=>setTimeout(r,700));
  if(practice==="single"){
    stopSession(false);
    setJudgement("ぴったりです！",true);
    setExpression("ok","この音は整いました！");
    changing=false; return;
  }
  if(sequenceIndex===0){
    await showScene("next2",1700); sequenceIndex=1; activeString="ni";
  }else if(sequenceIndex===1){
    await showScene("next3",1700); sequenceIndex=2; activeString="san";
  }else{
    stopSession(false);
    await showScene("complete",3200);
    setJudgement("三弦とも整いました！",true);
    setExpression("ok","調弦完了です！");
    changing=false; return;
  }
  setStringButtons(); setJudgement("三味線を弾いてください");
  setExpression("listening",`${LABELS[activeString]}を合わせよう`);
  startReferenceLoop(); changing=false;
}
async function startSession(stringName){
  try{
    await ensureAudio();
    await ensureMicrophone();
    running=true; activeString=stringName; stableFrames=0;
    setStringButtons(); startReferenceLoop(); startPitchLoop();
    els.mic.textContent=`${LABELS[stringName]}を準備中`;
    setJudgement("三味線を弾いてください");
    setExpression("listening","基準音のあとに弾いてね");
  }catch(error){
    console.error(error);
    setJudgement("マイクを開始できません");
    setExpression("retry","ブラウザのマイク許可を確認してください");
  }
}
function stopSession(reset=true){
  running=false; stopReferenceLoop(); cancelAnimationFrame(rafId);
  activeString=null; stableFrames=0; setStringButtons(); setNeedle(0);
  els.mic.textContent=reset?"合わせ方を選んでください":"測定を終了しました";
}
async function choosePractice(mode){
  stopSession(false); practice=mode;
  document.querySelectorAll("[data-practice]").forEach(b=>b.classList.toggle("active",b.dataset.practice===mode));
  if(mode==="sequence"){
    sequenceIndex=0;
    await showScene("go",2100);
    await startSession("ichi");
  }else{
    document.querySelectorAll("[data-string]").forEach(b=>b.disabled=false);
    els.mic.textContent="合わせたい糸を押してください";
    setJudgement("一の糸・二の糸・三の糸から選びます");
    setExpression("listening","合わせたい糸を選んでね");
  }
}
function bind(){
  document.querySelectorAll("[data-tuning]").forEach(btn=>btn.addEventListener("click",()=>{
    tuning=btn.dataset.tuning;
    document.querySelectorAll("[data-tuning]").forEach(b=>{
      const on=b.dataset.tuning===tuning;b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));
    });
    updateNotes();
    if(running) startReferenceLoop();
  }));
  document.querySelectorAll("[data-practice]").forEach(btn=>btn.addEventListener("click",()=>choosePractice(btn.dataset.practice)));
  document.querySelectorAll("[data-string]").forEach(btn=>btn.addEventListener("click",()=>{
    if(practice!=="single") return;
    stopSession(false); startSession(btn.dataset.string);
  }));
  els.count.addEventListener("change",()=>{updateNotes();if(running)startReferenceLoop();});
  els.stop.addEventListener("click",()=>{stopSession();practice=null;document.querySelectorAll("[data-practice]").forEach(b=>b.classList.remove("active"));});
}
function restore(){
  const savedCount=localStorage.getItem("shian-count");
  const savedTuning=localStorage.getItem("shian-tuning");
  if(savedCount && BASE[savedCount]) els.count.value=savedCount;
  if(savedTuning && MODES[savedTuning]){
    tuning=savedTuning;
    document.querySelectorAll("[data-tuning]").forEach(b=>{
      const on=b.dataset.tuning===tuning;b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));
    });
  }
  updateNotes();
}
async function registerSW(){
  if("serviceWorker" in navigator){
    try{await navigator.serviceWorker.register("./service-worker.js");}catch(e){console.warn(e);}
  }
}
function initializeTuningPage(){
  try{
    if(!els.count){
      console.error("調弦画面の初期化に必要な要素が見つかりません。");
      return;
    }
    restore();
    bind();
    document.documentElement.dataset.tuningReady="true";
  }catch(error){
    console.error("調弦画面の初期化に失敗しました:", error);
    if(els.judgement) els.judgement.textContent="画面の初期化に失敗しました。再読み込みしてください。";
  }
  registerSW();
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",initializeTuningPage,{once:true});
}else{
  initializeTuningPage();
}
})();