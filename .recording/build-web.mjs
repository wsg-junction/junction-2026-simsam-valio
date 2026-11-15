import { build } from 'vite';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const assets=path.resolve('apps/web/dist/assets');
const css=fs.readdirSync(assets).filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync(path.join(assets,x),'utf8')).join('\n');
await build({
 configFile:false,root:path.resolve('apps/web'),base:'/assistant/',esbuild:false,
 resolve:{alias:{'@':path.resolve('apps/web/src'),'@gateway':path.resolve('apps/mcp/src')}},
 plugins:[{name:'recording-typescript',enforce:'pre',transform(code,id){
  if(id.split('?')[0].replaceAll('\\','/').endsWith('/apps/web/src/index.css'))return {code:css,map:null};
  if(/\.[cm]?tsx?(?:\?|$)/.test(id))return {code:ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},fileName:id}).outputText,map:null};
 }}],
 build:{outDir:path.resolve('.recording/web-dist'),emptyOutDir:true,minify:false,cssMinify:false,target:'esnext'},
});
