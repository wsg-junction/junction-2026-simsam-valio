import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime='C:/Users/mailm/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {Presentation,PresentationFile}=await import(pathToFileURL(runtime+'/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs').href);
const skill='C:/Users/mailm/.codex/plugins/cache/openai-primary-runtime/presentations/26.1105.12137/skills/presentations';
const workspace=process.cwd(),build=path.resolve('.recording/deck-build'),out=path.resolve('slides');
await fs.mkdir(build,{recursive:true});await fs.mkdir(out,{recursive:true});
const p=Presentation.create({slideSize:{width:1280,height:720}});
const ink='#15202B',muted='#637181',blue='#0077BB';
function text(s,value,x,y,w,h,size=28,color=ink,bold=false){
 const t=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 t.text=value;t.text.style={fontFamily:'Arial',fontSize:size,color,bold};return t;
}
function slide(title,notes){const s=p.slides.add();s.background.fill='#FFFFFF';text(s,title,76,58,1128,110,44,ink,true);s.speakerNotes.text=notes;return s;}
async function image(s,file,x,y,w,h){const b=await fs.readFile(path.resolve('video/work/shots',file+'.png'));s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',alt:'Actual Aimo synthetic demo: '+file,fit:'contain',position:{left:x,top:y,width:w,height:h}});}
let s=p.slides.add();s.background.fill='#FFFFFF';
text(s,'Aimo Agent Gateway',76,192,1128,100,66,ink,true);
text(s,'Your agents. Your rules.',80,310,1100,70,36,blue);
text(s,'Junction 2026 · Trusted Trade Agents',80,599,1100,42,22,muted);
s.speakerNotes.text='Giving AI a shopping list is easy. Giving it purchasing authority takes trust. This is a working prototype for the Valio Aimo Trusted Trade Agents challenge. All purchasing examples in this deck are synthetic.';

s=slide('An order is a commitment','The opening joke illustrates the problem: a low price does not make the wrong product acceptable. Purchasing authority requires an explicit delivery deadline, dietary requirements, and a spending mandate. Source: challenge text supplied in the conversation.');
text(s,'“It was cheaper.”',80,220,1120,100,66,blue,true);
text(s,'The kitchen still needs lactose-free milk.\nAnd it still needs to arrive by Monday.',80,365,1100,140,34);

s=slide('One request','Use the challenge example to demonstrate the complete request → lookup → quote → order or approval flow. Source: supplied challenge brief and captured local application.');
text(s,'“I need 1,000 litres of\nlactose-free milk by Monday.”',80,210,1110,180,52,ink,true);
text(s,'The agent checks the request against the kitchen’s rules.',80,478,1100,90,28,muted);

s=slide('Price, availability and delivery','Actual local synthetic demo: the best-value combination totals €1,376 excluding VAT. It combines 400 L in bag-in-box packs and 600 L in cartons, arriving by Monday. The app also compares later and more expensive options and warns about shelf life. This is a synthetic example, not a live supplier price. Screenshot source: video/work/shots/03-products.png.');
await image(s,'03-products',432,185,795,447);
text(s,'€1,376',80,243,340,88,58,blue,true);
text(s,'1,000 litres\nArrives Monday',80,360,315,100,29);
text(s,'Synthetic demo · excl. VAT',80,563,340,52,19,muted);

s=slide('Authority belongs to the kitchen','The mandate controls spending and permitted categories. Orders within authority can be confirmed automatically. Requests outside the mandate require human approval. Hard sourcing requirements cannot be overridden by approving an order. Sources: apps/mcp/src/mandate.ts, apps/mcp/src/sourcing.ts, and the local requirements UI.');
text(s,'Within the mandate',80,220,520,54,33,blue,true);
text(s,'The agent can place the order.',80,298,520,100,29);
text(s,'Outside the mandate',700,220,500,54,33,ink,true);
text(s,'A human must approve it.',700,298,500,100,29);
text(s,'Hard requirements remain mandatory.',80,540,1100,70,30,ink,true);

s=slide('Approval before commitment','In the captured flow, the €1,550 whole-milk order exceeds the €1,500 per-order limit and would exceed the remaining weekly budget after the first order. It waits for a human. The buyer can approve, reject, or change the request. Screenshot source: video/work/shots/17-approve-dialog.png. This is synthetic purchasing, not a production transaction.');
await image(s,'17-approve-dialog',430,185,798,449);
text(s,'€1,550',80,240,330,88,58,blue,true);
text(s,'Outside the limit.\nWaiting for Maria.',80,358,330,120,29);

s=slide('Supplier problems stay visible','A simulated supplier production stoppage prevents delivery of 500 L. The gateway produces replacement options and records the event. A different product may require approval under the mandate. The wider app also includes stock monitoring, menu baskets, event planning, and delivery reconciliation. Sources: video/work/shots/18-disruption.png; apps/mcp/src/fulfilment.ts.');
await image(s,'18-disruption',432,185,795,447);
text(s,'Review alternatives',80,245,340,100,36,blue,true);
text(s,'Compare the change.\nKeep the requirements.',80,384,330,130,28);

s=slide('An open interface for purchasing agents','MCP is the open agent-facing interface implemented by the gateway. Scoped tokens identify agents and constrain tool access. The gateway evaluates the buyer mandate, produces signed fixed-price quotes in the synthetic demo, and records decisions in an audit log. Current scope: prototype with mock supplier systems; production rollout would require buyer authentication, a connected order backend, and operational hardening. Sources: apps/mcp/README.md; apps/mcp/src/mcp.ts; apps/mcp/src/tokens.ts; apps/mcp/src/signing.ts; apps/mcp/src/api.ts.');
text(s,'MCP',80,218,1100,100,72,blue,true);
text(s,'Connect external assistants through scoped access.',80,358,1110,65,32);
text(s,'Enforce the mandate at the gateway.\nKeep a readable record of each decision.',80,454,1110,115,30);
text(s,'Prototype with synthetic data and mock systems',80,622,1120,40,21,muted);

s=p.slides.add();s.background.fill='#FFFFFF';
text(s,'Your agents. Your rules.',76,220,1130,110,62,ink,true);
text(s,'Breakfast sorted.',80,363,1100,80,42,blue);
text(s,'Aimo Agent Gateway',80,598,1100,44,24,muted);
s.speakerNotes.text='Close with the core promise: useful purchasing autonomy, governed by the kitchen. Invite the judges to see the end-to-end synthetic demo or the accompanying showcase video. No real purchasing systems or confidential business data are used.';

for(let i=0;i<p.slides.items.length;i++){
 const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(build,`slide-${i+1}.png`),new Uint8Array(await blob.arrayBuffer()));
 console.log('Rendered',i+1);
}
const draft=path.join(build,'candidate.pptx');await(await PresentationFile.exportPptx(p)).save(draft);
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const final=path.join(out,'aimo-agent-gateway.pptx');
const result=await finalizePresentation({workspaceDir:workspace,candidatePath:draft,finalPath:final,
 pythonExecutable:runtime+'/python/python.exe',
 integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',
 layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
 fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,
 receiptPath:path.join(build,'validation.json'),requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
});console.log('FINAL',JSON.stringify(result));
