const {chromium}=require('playwright');
const fs=require('node:fs/promises');
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 try{const p=await b.newPage({viewport:{width:1920,height:1080}});p.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await p.goto('http://127.0.0.1:9346/work/editor.html');
 const timer=setInterval(async()=>{try{console.log(JSON.stringify(await p.evaluate(()=>window.progress)));}catch{}},15000);
 try{await p.evaluate(()=>window.run());}finally{clearInterval(timer);}
 const result=await p.evaluate(()=>window.result);const bytes=Buffer.from(result.data,'base64');delete result.data;
 await fs.writeFile('video/aimo-showcase.mp4',bytes);await fs.writeFile('video/work/export-report.json',JSON.stringify({...result,bytes:bytes.length},null,2));
 await p.screenshot({path:'video/work/closing-preview.png'});console.log('EXPORTED',JSON.stringify({...result,bytes:bytes.length}));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
