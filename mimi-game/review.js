(() => {
  "use strict";
  const engine=window.ShianAudioEngine,status=document.getElementById("status"),playAllButton=document.getElementById("play-all"),stopButton=document.getElementById("stop-all"),closeButton=document.getElementById("close-window"),quickGrid=document.getElementById("quick-grid"),keys=[...document.querySelectorAll(".key")];
  let playbackToken=0,playingAll=false;
  const wait=(ms)=>new Promise((r)=>setTimeout(r,ms));
  const keyFor=(hon)=>document.querySelector(`.key[data-hon="${hon}"]`);
  const quickFor=(hon)=>document.querySelector(`.quick-button[data-hon="${hon}"]`);
  function clearPlaying(){keys.forEach(k=>k.classList.remove("playing"));document.querySelectorAll(".quick-button").forEach(b=>b.classList.remove("playing"))}
  function markPlaying(hon){clearPlaying();keyFor(hon)?.classList.add("playing");quickFor(hon)?.classList.add("playing")}
  async function ensureAudio(){if(!engine)throw new Error("先生音源を利用できません。");await engine.resume();await engine.load()}
  async function playOne(hon){const token=++playbackToken;playingAll=false;engine.stopAll();clearPlaying();try{await ensureAudio();markPlaying(hon);status.textContent=`${hon}本を再生しています。`;const duration=await engine.play(hon,{exclusive:true,volume:1});await wait(Math.max(650,duration*1000+180));if(token===playbackToken){clearPlaying();status.textContent=`${hon}本を確認しました。`}}catch(error){clearPlaying();status.textContent=error?.message||"音を再生できませんでした。"}}
  async function playAll(){const token=++playbackToken;playingAll=true;engine.stopAll();clearPlaying();try{await ensureAudio();playAllButton.disabled=true;for(let hon=1;hon<=12;hon+=1){if(!playingAll||token!==playbackToken)break;markPlaying(hon);status.textContent=`${hon}本を再生中`;const duration=await engine.play(hon,{exclusive:true,volume:1});await wait(Math.max(650,duration*1000+180))}}catch(error){status.textContent=error?.message||"音を再生できませんでした。"}finally{if(token===playbackToken){clearPlaying();playingAll=false;playAllButton.disabled=false;status.textContent="連続再生が終わりました。"}}}
  function stopAll(){playbackToken+=1;playingAll=false;engine?.stopAll();clearPlaying();playAllButton.disabled=false;status.textContent="停止しました。"}
  for(let hon=1;hon<=12;hon+=1){const b=document.createElement("button");b.type="button";b.className="quick-button";b.dataset.hon=String(hon);b.textContent=`${hon}本`;b.addEventListener("click",()=>playOne(hon));quickGrid.appendChild(b)}
  keys.forEach(k=>k.addEventListener("click",()=>playOne(Number(k.dataset.hon))));playAllButton.addEventListener("click",playAll);stopButton.addEventListener("click",stopAll);
  closeButton.addEventListener("click",()=>{stopAll();window.close();setTimeout(()=>{if(!window.closed&&document.visibilityState==="visible")history.back()},120)});
})();