const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
 const server = http.createServer((req,res)=>{
  const name = path.basename(decodeURIComponent(req.url));
  const file = path.join(process.cwd(),'video',name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {res.end('missing'); return;}
  res.setHeader('Content-Type',name.endsWith('mp3')?'audio/mpeg':'video/mp4');
  fs.createReadStream(file).pipe(res);
 }).listen(9345,'127.0.0.1');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const p=await browser.newPage({viewport:{width:1920,height:1080}});
 await p.goto('http://127.0.0.1:9345/');
 for(const name of ['opener.mp4','start.mp3','body.mp3']) {
  console.log(name,await p.evaluate(name=>new Promise((resolve,reject)=>{
   const el=document.createElement(name.endsWith('mp3')?'audio':'video');
   el.onloadedmetadata=()=>resolve({duration:el.duration,width:el.videoWidth,height:el.videoHeight});
   el.onerror=()=>reject(new Error('media load failed')); el.src='/'+name;
  }),name));
 }
 await p.goto('https://savings-rated-catch-owners.trycloudflare.com',{waitUntil:'domcontentloaded',timeout:45000});
 await p.waitForTimeout(3000);
 console.log('APP',p.url(),await p.locator('body').innerText());
 await p.screenshot({path:'.recording/output/remote-app.png'});
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
