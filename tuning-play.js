(() => {
"use strict";

const BASE = {1:155.56,2:146.83,3:138.59,4:130.81,5:123.47,6:116.54,7:110.00,8:103.83,9:98.00,10:92.50,11:87.31,12:82.41};
const MODES = {
  hon:{label:"本調子", ratios:{ichi:1,ni:4/3,san:2}},
  niage:{label:"二上り",ratios:{ichi:1,ni:3/2,san:2}},
  sansage:{label:"三下り",ratios:{ichi:1,ni:4/3,san:16/9}}
};
const LABELS={ichi:"一の糸",ni:"二の糸",san:"三の糸"};
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

const tuning=localStorage.getItem("shian-tuning") || "hon";
const practice=localStorage.getItem("shian-practice") || "sequence";
const count=Number(localStorage.getItem("shian-count") || 6);
const mode=MODES[tuning] || MODES.hon;
const base=BASE[count] || BASE[6];
const notes={ichi:base,ni:base*mode.ratios.ni,san:base*mode.ratios.san};
const noteNumbers=(window.ShianTuningMap[tuning] || window.ShianTuningMap.hon)[count];
const stringIndex={ichi:0,ni:1,san:2};

let activeString=null, sequenceIndex=0;
let mediaStream=null, analyser=null, micSource=null;
let loopTimer=null, rafId=null, suppressUntil=0, stableFrames=0, running=false, changing=false;

const $=id=>document.getElementById(id);
const els={
  summary:$("playSummary"),hzIchi:$("hzIchi"),hzNi:$("hzNi"),hzSan:$("hzSan"),
  stop:$("stopButton"),mic:$("micState"),needle:$("meterNeedle"),judgement:$("judgement"),
  expression:$("expressionImage"),message:$("shamiMessage"),overlay:$("sceneOverlay"),scene:$("sceneImage")
};

function currentNoteNumber(){
  return noteNumbers[stringIndex[activeString]];
}
function renderSettings(){
  els.summary.textContent=`${count}本・${mode.label}／${practice==="sequence"?"三弦を順番に合わせる":"一音ずつ合わせる"}`;
  els.hzIchi.textContent=`${notes.ichi.toFixed(2)} Hz`;
  els.hzNi.textContent=`${notes.ni.toFixed(2)} Hz`;
  els.hzSan.textContent=`${notes.san.toFixed(2)} Hz`;
}
function setExpression(kind,message){
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
async function playTeacherOnce(){
  if(!running || !activeString) return;
  const duration=await window.ShianAudioEngine.play(currentNoteNumber());
  suppressUntil=performance.now()+(duration*1000)+250;
}
function startReferenceLoop(){
  stopReferenceLoop();
  playTeacherOnce().catch(handleAudioError);
  loopTimer=setInterval(()=>playTeacherOnce().catch(handleAudioError),3000);
}
function stopReferenceLoop(){
  if(loopTimer){clearInterval(loopTimer);loopTimer=null;}
  window.ShianAudioEngine.stop();
}
function handleAudioError(error){
  console.error(error);
  setJudgement("基準音を再生できません");
  setExpression("retry","画面を一度タップして、もう一度試してください");
}
async function ensureMicrophone(){
  if(mediaStream) return;
  mediaStream=await navigator.mediaDevices.getUserMedia({
    audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}
  });
  const audioContext=await window.ShianAudioEngine.resume();
  analyser=audioContext.createAnalyser();
  analyser.fftSize=4096;
  micSource=audioContext.createMediaStreamSource(mediaStream);
  micSource.connect(analyser);
}
function startPitchLoop(){
  cancelAnimationFrame(rafId);
  const audioContext=window.ShianAudioEngine.getContext();
  const data=new Float32Array(analyser.fftSize);
  const tick=()=>{
    if(!running) return;
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
    while(cents>700)cents-=1200;
    while(cents<-700)cents+=1200;
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
      else{setJudgement("あと少し低くしてください");setExpression("adjust","あと少し♪");}
    }
    rafId=requestAnimationFrame(tick);
  };
  rafId=requestAnimationFrame(tick);
}
async function handleMatched(){
  if(changing) return;
  changing=true; stableFrames=0; stopReferenceLoop();
  await new Promise(r=>setTimeout(r,700));

  if(practice==="single"){
    stopSession(false);
    setJudgement("ぴったりです！",true);
    setExpression("ok","この音は整いました！");
    changing=false;
    return;
  }

  if(sequenceIndex===0){
    await showScene("next2",1700);
    sequenceIndex=1;
    activeString="ni";
  }else if(sequenceIndex===1){
    await showScene("next3",1700);
    sequenceIndex=2;
    activeString="san";
  }else{
    stopSession(false);
    await showScene("complete",3200);
    setJudgement("三弦とも整いました！",true);
    setExpression("ok","調弦完了です！");
    changing=false;
    return;
  }

  setStringButtons();
  setJudgement("三味線を弾いてください");
  setExpression("listening",`${LABELS[activeString]}を合わせよう`);
  startReferenceLoop();
  changing=false;
}
async function startSession(stringName){
  try{
    await window.ShianAudioEngine.load();
    await ensureMicrophone();
    running=true;
    activeString=stringName;
    stableFrames=0;
    setStringButtons();
    startReferenceLoop();
    startPitchLoop();
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
  running=false;
  stopReferenceLoop();
  cancelAnimationFrame(rafId);
  activeString=null;
  stableFrames=0;
  setStringButtons();
  setNeedle(0);
  els.mic.textContent=reset?"停止しました":"測定を終了しました";
}
function bind(){
  document.querySelectorAll("[data-string]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(practice!=="single") return;
      stopSession(false);
      startSession(btn.dataset.string);
    });
  });
  els.stop.addEventListener("click",()=>stopSession());
}
async function initialize(){
  renderSettings();
  bind();

  if(practice==="sequence"){
    sequenceIndex=0;
    await showScene("go",2100);
    await startSession("ichi");
  }else{
    document.querySelectorAll("[data-string]").forEach(btn=>btn.disabled=false);
    els.mic.textContent="合わせたい糸を押してください";
    setJudgement("一の糸・二の糸・三の糸から選びます");
    setExpression("listening","合わせたい糸を選んでね");
  }

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  }
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",initialize,{once:true});
}else{
  initialize();
}
})();
