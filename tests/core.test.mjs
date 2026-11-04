import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS } from "../js/questions.js";
import { cleanName, validateName, cleanCode, formatCode, isComplete, completedResponses,
  summarize, findMatches, toCsv, escapeHtml, answerPhrase, checkConfig } from "../js/core.js";
const row=(id,name,answers,submitted=true)=>({id,name,answers,submitted_at:submitted?"2026-11-04T07:00:00Z":null,updated_at:"2026-11-04T07:00:00Z"});

test("수업 문항은 5개이고 보기 수는 4,4,2,2,2",()=>{
  assert.deepEqual(QUESTIONS.map(q=>q.options.length),[4,4,2,2,2]);
  assert.equal(QUESTIONS[4].options[1].fr,"Rendre public tout mon historique de recherche");
});
test("이름과 반 코드 입력을 정리하고 24자 한도를 적용",()=>{
  assert.equal(cleanName("  e\u0301  민서  "),"é 민서");
  assert.equal(validateName("  "),"짝의 이름을 입력해 주세요.");
  assert.ok(validateName("가".repeat(25)));
  assert.equal(validateName("Jean-Pierre"),"");
  assert.equal(cleanCode(" a1b2-c3d4 e5f6 "),"A1B2C3D4E5F6");
  assert.equal(formatCode("A1B2C3D4E5F6"),"A1B2-C3D4-E5F6");
});
test("하나라도 미응답, 잘못된 인덱스, 문자열, NaN이면 최종 제출 불가",()=>{
  assert.ok(isComplete([0,3,1,0,1]));
  for(const a of [[0,0,null,0,0],[0,0,2,0,0],[0,0,0,0],["0",0,0,0,0],[0,0,NaN,0,0],[0,0,0,0,0,0],null]) assert.equal(isComplete(a),false);
  assert.equal(isComplete(Array(5)),false);
});
test("그래프는 제출 완료한 유효 응답만 집계하고 빈 반은 모두 0%",()=>{
  const rows=[row("a","A",[0,0,1,0,0]),row("b","B",[0,2,0,0,1]),row("c","C",[1,3,0,1,0],false),row("x","X",[0,0,8,0,0])];
  assert.equal(completedResponses(rows).length,2);
  const summary=summarize(rows);
  assert.deepEqual(summary[0].counts,[2,0,0,0]);
  assert.deepEqual(summary[4].percentages,[50,50]);
  assert.ok(summarize([]).every(q=>q.percentages.every(v=>v===0)));
});
test("친구 매칭은 자신을 제외하고 가장 높은 일치 개수의 동점을 모두 반환",()=>{
  const rows=[row("me","나",[0,1,0,1,0]),row("b","지우",[0,1,0,1,0]),row("a","민서",[0,1,0,1,0]),row("c","다른 친구",[0,0,0,1,0])];
  const result=findMatches(rows,"me");
  assert.equal(result.score,5);
  assert.deepEqual(result.matches.map(r=>r.id),["a","b"]);
  assert.deepEqual(result.matches[0].shared,[0,1,2,3,4]);
});
test("모두 불일치인 경우에도 0점 동점을 반환, 혼자/미선택일 때 매칭 없음",()=>{
  const me=row("me","나",[0,0,0,0,0]);
  assert.equal(findMatches([me,row("f","친구",[1,1,1,1,1])],"me").score,0);
  assert.equal(findMatches([me],"me").matches.length,0);
  assert.equal(findMatches([me],"missing").me,null);
});
test("프랑스어 대답의 첫 글자만 소문자로 연결",()=>{
  assert.equal(answerPhrase(QUESTIONS[2],0),"passer un examen tous les lundis");
  assert.equal(answerPhrase(QUESTIONS[0],null),"________________");
});
test("이름에 HTML이 있어도 출력 시 문자로 표시하고 CSV의 수식 실행을 방지",()=>{
  assert.equal(escapeHtml('<img onerror="x">'),"&lt;img onerror=&quot;x&quot;&gt;");
  const csv=toCsv([row("a","=1+1",[0,0,0,0,0]),row("b",'민서,"', [0,0,0,0,0])]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"민서,"""'));
  assert.equal(csv.split("\r\n").length,3);
});
test("DB 설정이 없을 때만 체험 모드이며 일부 설정/비밀 키를 거부",()=>{
  assert.equal(checkConfig({}).mode,"demo");
  assert.throws(()=>checkConfig({supabaseUrl:"https://x.supabase.co"}));
  assert.throws(()=>checkConfig({supabaseUrl:"https://x.supabase.co",supabaseKey:"sb_secret_unsafe"}));
  const jwt="x."+btoa(JSON.stringify({role:"service_role"}))+".x";
  assert.throws(()=>checkConfig({supabaseUrl:"https://x.supabase.co",supabaseKey:jwt}));
  const config=checkConfig({supabaseUrl:"https://x.supabase.co/",supabaseKey:"sb_publishable_example"});
  assert.equal(config.url,"https://x.supabase.co");
  assert.equal(config.mode,"connected");
});
