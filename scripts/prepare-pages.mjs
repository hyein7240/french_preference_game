import { cp, mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "_site");
for (const font of ["Pretendard-Regular.woff2","Pretendard-Bold.woff2"]) {
  await access(resolve(root,"assets","fonts",font));
}
await rm(out,{ recursive:true, force:true });
await mkdir(out,{ recursive:true });
for (const path of ["index.html","styles.css","config.js","js","assets",".nojekyll"]) {
  await cp(resolve(root,path),resolve(out,path),{ recursive:true });
}
console.log("GitHub Pages 정적 파일 준비 완료: _site/");
