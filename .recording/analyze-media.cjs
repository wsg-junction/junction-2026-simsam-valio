const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async()=>{
 await fs.mkdir('video/work',{recursive:true});
 const b=await chromium.launch({channel:'chrome',headless:true});
 try {
 const p=await b.newPage();
 for(const name of ['start','body']) {
  const data=(await fs.readFile(`video/${name}.mp3`)).toString('base64');
  const result=await p.evaluate(async data=>{
   const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
   const ac=new AudioContext();const decoded=await ac.decodeAudioData(bytes.buffer);
   const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
   const src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start();
   const mono=(await offline.startRendering()).getChannelData(0);
   const buffer=new ArrayBuffer(44+mono.length*2),v=new DataView(buffer);
   const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
   str(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');
   v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);
   v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,mono.length*2,true);
   for(let i=0;i<mono.length;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,mono[i]))*32767,true);
   let first=0,last=mono.length-1;while(first<last&&Math.abs(mono[first])<0.008)first++;
   while(last>first&&Math.abs(mono[last])<0.008)last--;
   const bytesOut=new Uint8Array(buffer);let binary='';for(let i=0;i<bytesOut.length;i+=8192)binary+=String.fromCharCode(...bytesOut.subarray(i,i+8192));
   await ac.close();return {duration:decoded.duration,trimStart:Math.max(0,first/16000-.12),trimEnd:Math.min(decoded.duration,last/16000+.2),wav:btoa(binary)};
  },data);
  await fs.writeFile(`video/work/${name}.wav`,Buffer.from(result.wav,'base64'));
  delete result.wav;await fs.writeFile(`video/work/${name}-analysis.json`,JSON.stringify(result,null,2));
  console.log(name,result);
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
