const {chromium}=require('playwright');
const fs=require('node:fs/promises');
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
 const p=await b.newPage({viewport:{width:960,height:540}});
 await p.goto('http://127.0.0.1:9346/work/editor.html');
 const info=await p.evaluate(async()=>{
  document.body.innerHTML='<video style="width:100vw;height:100vh;object-fit:contain;background:black" preload="auto"></video>';
  const v=document.querySelector('video');v.src='/aimo-showcase.mp4';
  await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});
  const audioContext=new AudioContext();const audio=await audioContext.decodeAudioData(await(await fetch('/aimo-showcase.mp4')).arrayBuffer());
  const samples=audio.getChannelData(0);const windows=[];
  for(let sec=0;sec<audio.duration;sec+=5){let energy=0,peak=0;const a=Math.floor(sec*audio.sampleRate),end=Math.min(samples.length,a+audio.sampleRate*5);for(let i=a;i<end;i++){energy+=samples[i]*samples[i];peak=Math.max(peak,Math.abs(samples[i]));}windows.push({start:sec,rms:Math.sqrt(energy/(end-a)),peak});}
  await audioContext.close();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,audioDuration:audio.duration,audioChannels:audio.numberOfChannels,windows};
 });
 console.log(JSON.stringify(info));
 for(const time of [1,12,26,42,58,72,84]){if(time>=info.duration)continue;
  await p.evaluate(time=>new Promise(resolve=>{const v=document.querySelector('video');v.onseeked=resolve;v.currentTime=time;}),time);
  await p.screenshot({path:`video/work/check-${time}.png`});
 }
 await fs.writeFile('video/work/verification.json',JSON.stringify(info,null,2));
 if(info.width!==1920||info.height!==1080||info.audioDuration<70)throw new Error('Unexpected media dimensions or missing narration.');
 if(info.windows.slice(2,-1).some(w=>w.rms<.0001))throw new Error('Unexpected silent section in narration.');
 console.log('VERIFIED');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
