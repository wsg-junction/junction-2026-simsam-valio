const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve('video');
http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 const size=fs.statSync(file).size;
 const types={'.html':'text/html','.png':'image/png','.mp4':'video/mp4','.mp3':'audio/mpeg','.json':'application/json'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
 res.setHeader('Access-Control-Allow-Origin','*');
 const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
 if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),size-1):size-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}
 else{res.setHeader('Content-Length',size);fs.createReadStream(file).pipe(res);}
}).listen(9346,'127.0.0.1',()=>console.log('Media: http://127.0.0.1:9346'));
