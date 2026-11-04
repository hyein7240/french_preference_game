import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const port=Number(process.env.PORT || 4173);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".woff2":"font/woff2",".txt":"text/plain; charset=utf-8"};
const server=http.createServer(async(req,res)=>{
  try {
    if(!["GET","HEAD"].includes(req.method)){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,"http://localhost");
    const path=decodeURIComponent(url.pathname)==="/"?"index.html":decodeURIComponent(url.pathname).replace(/^\//u,"");
    if(!/^(index\.html|styles\.css|config\.js|js\/[a-z0-9.-]+|assets\/[a-zA-Z0-9/_.-]+)$/u.test(path)) throw new Error("not found");
    const file=resolve(root,path);
    if(!file.startsWith(root+sep) || !(await stat(file)).isFile()) throw new Error("not found");
    const data=await readFile(file);
    res.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream","Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
    res.end(req.method==="HEAD"?undefined:data);
  } catch {res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("파일을 찾을 수 없습니다.");}
});
server.listen(port,"127.0.0.1",()=>console.log(`Binôme: http://127.0.0.1:${port}`));
