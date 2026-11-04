// 브라우저 렌더러가 아닌, 실제 애플리케이션 모듈의 이벤트/화면 전환 검증입니다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

test("이름 입력부터 5문항·수정·제출·친구 매칭·역할 교대·교사 반 관리까지",async()=>{
  const listeners={};
  const elements=new Map();
  const document={activeElement:null,hidden:false,addEventListener(){},body:{append(){}}};
  class Element {
    constructor(id="",tagName="DIV") {this.id=id;this.tagName=tagName;this.innerHTML="";this.textContent="";this.handlers={};this.hidden=false;this.disabled=false;}
    addEventListener(name,fn) {(this.handlers[name]||=[]).push(fn);}
    focus() {document.activeElement=this;}
    setAttribute(name,value) {this[name]=value;}
  }
  document.getElementById=id=>{
    if(!elements.has(id)) elements.set(id,new Element(id));
    return elements.get(id);
  };
  document.querySelector=()=>new Element("","H1");
  const local=new Map();
  const storage={getItem:key=>local.has(key)?local.get(key):null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
  const location={href:"https://example.test/binome/"};
  let hash="";
  Object.defineProperty(location,"hash",{get:()=>hash,set:value=>{
    hash=value;location.href="https://example.test/binome/"+value;
    queueMicrotask(()=>{for(const fn of listeners.hashchange||[]) fn();});
  }});
  const window={BINOME_CONFIG:{},location,scrollTo(){},addEventListener(name,fn){(listeners[name]||=[]).push(fn);}};
  const sandbox={window,document,location,navigator:{},localStorage:storage,sessionStorage:storage,
    crypto:webcrypto,URL,URLSearchParams,Blob,AbortController,console,queueMicrotask,
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    FormData:class {constructor(form){this.data=form.data;}get(key){return this.data[key];}}};
  let source="";
  for(const module of ["questions","core","storage","api","demo","app"]) {
    const raw=await readFile(new URL(`../js/${module}.js`,import.meta.url),"utf8");
    source+=raw.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gmu,"").replace(/^export (?=(?:const|function|class)\b)/gmu,"")+"\n";
  }
  vm.runInNewContext(source,sandbox,{timeout:5000});
  const app=elements.get("app");
  const settle=async()=>{for(let n=0;n<5;n++) await new Promise(resolve=>setImmediate(resolve));};
  const submit=async(type,data)=>{
    const form={dataset:{form:type},data};
    app.handlers.submit[0]({target:{closest:()=>form},preventDefault(){}});await settle();
  };
  const click=async(action,data={})=>{
    app.handlers.click[0]({target:{closest:()=>({dataset:{action,...data},disabled:false})}});await settle();
  };
  const change=async(id,value,question)=>{
    app.handlers.change[0]({target:{id,value,dataset:{question},matches:()=>question!==undefined,checked:true}});await settle();
  };
  const data=()=>JSON.parse(local.get("binome:v1:demo-database"));

  assert.match(app.innerHTML,/Prénom de mon\/ma binôme/u);
  await submit("start",{code:"B10B-2026-0001",name:"테스트 친구"});
  assert.match(app.innerHTML,/Qu’est-ce que tu adores/u);
  assert.equal(data().responses.find(r=>r.name==="테스트 친구").submitted_at,null);
  location.hash="#/done";await settle();
  assert.match(app.innerHTML,/짝의 답을 확인해요/u);
  location.hash="#/interview/1";await settle();
  for(let i=0;i<5;i++) {await change(`option-${i}-${i%2}`,String(i%2),String(i));await click("next");}
  assert.match(app.innerHTML,/짝의 답을 확인해요/u);
  assert.equal(data().responses.filter(r=>r.submitted_at).length,8);
  await click("edit-question",{step:"2"});
  await change("option-2-1","1","2");await click("next");
  await click("submit");
  assert.match(app.innerHTML,/짝의 취향을 기록했어요/u);
  let row=data().responses.find(r=>r.name==="테스트 친구");
  assert.deepEqual(row.answers,[0,1,1,1,0]);
  assert.equal(data().responses.filter(r=>r.submitted_at).length,9);

  location.hash="#/dashboard";await settle();
  assert.match(app.innerHTML,/Trouve ton duo/u);
  await change("my-name","demo-student-1");
  assert.match(app.innerHTML,/일치율 100%/u);
  assert.match(app.innerHTML,/지우/u);assert.match(app.innerHTML,/유진/u);

  location.hash="#/done";await settle();await click("new-interview");
  assert.match(app.innerHTML,/id="partner-name" name="name" value=""/u);
  assert.equal(data().responses.filter(r=>r.submitted_at).length,9);
  await click("resume",{id:row.id});
  assert.match(app.innerHTML,/짝의 답을 확인해요/u);
  await click("edit-question",{step:"0"});await change("option-0-1","1","0");await click("next");await click("submit");
  row=data().responses.find(r=>r.name==="테스트 친구");
  assert.equal(row.answers[0],1);assert.equal(data().responses.filter(r=>r.submitted_at).length,9);

  location.hash="#/teacher";await settle();await click("demo-login");
  assert.match(app.innerHTML,/오늘의 수업을 준비해요/u);
  await submit("create-room",{name:"테스트 새 반",days:"7"});
  assert.match(app.innerHTML,/테스트 새 반/u);
  const room=data().rooms.find(r=>r.name==="테스트 새 반");
  await click("teacher-dashboard",{id:room.id,code:room.code});
  assert.match(app.innerHTML,/첫 번째 인터뷰를 기다리고 있어요/u);
  await click("toggle-room");
  assert.equal(data().rooms.find(r=>r.id===room.id).is_open,false);
  assert.match(app.innerHTML,/제출 마감/u);
});
