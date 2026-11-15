const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const root='http://localhost:8791';
(async()=>{
 await fs.mkdir('video/work/shots',{recursive:true});
 const b=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 try {
 const p=await b.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1,colorScheme:'light'});
 p.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await p.request.post(root+'/api/reset',{data:{}});
 const shot=async name=>{await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(650);await p.screenshot({path:`video/work/shots/${name}.png`});console.log('SHOT',name);};
 await p.goto(root+'/assistant/',{waitUntil:'networkidle'});await shot('01-home');
 const input=p.locator('textarea');await input.fill('I need 1,000 L of lactose-free milk by Monday');await shot('02-request');
 await input.press('Enter');await p.waitForTimeout(2200);await p.evaluate(()=>window.scrollTo(0,0));await shot('03-products');
 await p.getByRole('button',{name:/Get total quote/}).first().click();await p.waitForTimeout(700);await shot('14-quote');
 await p.getByRole('button',{name:/Order all/}).last().click();await p.waitForTimeout(700);await shot('15-confirmed');
 await p.getByRole('button',{name:/Get total quote/}).nth(2).click();await p.waitForTimeout(700);
 await p.getByRole('button',{name:/Order all/}).last().click();await p.waitForTimeout(700);await shot('16-pending');
 await fs.writeFile('video/work/chat-dom.txt',await p.locator('body').innerText());
 for(const [slug,name] of [['requirements','04-requirements'],['limits','05-limits'],['automations','06-automations']]){
  await p.goto(root+'/assistant/'+slug,{waitUntil:'networkidle'});await shot(name);
 }
 for(const [slug,name] of [['','07-console'],['approvals','08-approvals'],['orders','09-orders'],['stock','10-stock'],['agents','11-agents'],['rules','12-rules'],['activity','13-activity']]){
  await p.goto(root+'/app/'+slug,{waitUntil:'networkidle'});await shot(name);
 }
 await p.goto(root+'/app/approvals',{waitUntil:'networkidle'});
 console.log('BUTTONS',await p.getByRole('button').allTextContents());
 if(await p.getByRole('button',{name:'Approve',exact:true}).count()) {
  await p.getByRole('button',{name:'Approve',exact:true}).first().click();await shot('17-approve-dialog');
  await p.getByRole('button',{name:/Approve order/}).last().click();await p.waitForTimeout(900);
 }
 const orders=await (await p.request.get(root+'/api/orders')).json();
 console.log('ORDERS',JSON.stringify(orders.map(o=>({id:o.orderId,status:o.status,total:o.total}))));
 const confirmed=orders.find(o=>o.status==='confirmed');
 if(confirmed){
  await p.request.post(root+'/api/orders/'+confirmed.orderId+'/disruption',{data:{}});
  await p.goto(root+'/app/orders/'+confirmed.orderId,{waitUntil:'networkidle'});await shot('18-disruption');
 }
 await p.goto(root+'/app/activity',{waitUntil:'networkidle'});await shot('13-activity');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
