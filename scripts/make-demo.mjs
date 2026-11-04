// 외부 의존성 없이 화면 확인용 단일 HTML을 만듭니다. 배포용 index.html은 별도입니다.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFile(resolve(root,path),"utf8");
const logo="data:image/svg+xml;base64,"+(await readFile(resolve(root,"assets/logo.svg"))).toString("base64");
let css=await read("styles.css");
for(const font of ["Regular","Bold"]) {
  const data=(await readFile(resolve(root,`assets/fonts/Pretendard-${font}.woff2`))).toString("base64");
  css=css.replace(`./assets/fonts/Pretendard-${font}.woff2`,`data:font/woff2;base64,${data}`);
}
const modules=["questions","core","storage","api","demo","app"];
let js="";
for(const module of modules) {
  let source=await read(`js/${module}.js`);
  source=source.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gmu,"").replace(/^export (?=(?:const|function|class)\b)/gmu,"");
  js+=source+"\n";
}
js=js.replaceAll('./assets/logo.svg',logo).replace(/<\/script/giu,"<\\/script");
let html=await read("index.html");
html=html.replace(/  <link rel="preload"[^\n]+\n/u,"")
  .replace('href="./assets/favicon.svg"',`href="${logo}"`)
  .replace('  <link rel="stylesheet" href="./styles.css">',`  <style>${css}</style>`)
  .replace('  <script src="./config.js" defer></script>',"")
  .replace('  <script type="module" src="./js/app.js"></script>',"")
  .replace("</body>",`<script>window.BINOME_CONFIG={};</script>\n<script type="module">${js}</script>\n</body>`);
await writeFile(resolve(root,"DEMO.html"),html);
console.log("단일 체험 파일 생성 완료: DEMO.html");
