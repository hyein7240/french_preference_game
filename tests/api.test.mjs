import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseApi } from "../js/api.js";
const config={url:"https://test.supabase.co",key:"sb_publishable_test"};
const reply=(status,data)=>({ok:status>=200 && status<300,status,text:async()=>data===null?"":JSON.stringify(data)});

test("학생 RPC는 반 코드를 정리하고 공개 키만 APIKEY 헤더에 전송",async()=>{
  let called;
  const api=new SupabaseApi(config,async(url,opts)=>{called={url,opts};return reply(200,{id:"room"});});
  await api.room("abcd-1234-5678");
  assert.equal(called.url,"https://test.supabase.co/rest/v1/rpc/binome_room");
  assert.equal(called.opts.headers.apikey,"sb_publishable_test");
  assert.equal(called.opts.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(called.opts.body),{p_code:"ABCD12345678"});
});
test("제출은 5개 답변, UUID 편집 토큰, 버전을 한 요청으로 전송",async()=>{
  let called;
  const api=new SupabaseApi(config,async(url,opts)=>{called=JSON.parse(opts.body);return reply(200,{version:2});});
  await api.submit("ABCD12345678",{id:"uuid",token:"edit-uuid",answers:[0,1,0,1,0],version:1});
  assert.deepEqual(called,{p_code:"ABCD12345678",p_response_id:"uuid",p_edit_token:"edit-uuid",p_answers:[0,1,0,1,0],p_expected_version:1});
});
test("DB 오류를 학생이 이해할 문구로 전달하고 네트워크 실패를 체험 데이터로 대체하지 않음",async()=>{
  const api=new SupabaseApi(config,async()=>reply(400,{message:"NAME_TAKEN",code:"P0001"}));
  await assert.rejects(()=>api.room("code"),error=>error.code==="NAME_TAKEN" && /이미 등록/.test(error.message));
  const offline=new SupabaseApi(config,async()=>{throw new TypeError("network unavailable");});
  await assert.rejects(()=>offline.dashboard("code"),error=>error.code==="NETWORK_ERROR");
});
test("교사 기능은 로그인 없이 호출할 수 없음",async()=>{
  const api=new SupabaseApi(config,async()=>{throw new Error("should not reach network");});
  api.session=null;
  await assert.rejects(()=>api.createRoom("1반",7),error=>error.code==="AUTH_REQUIRED");
});
test("교사 로그인은 Auth 토큰을 사용하고 로그아웃 시 세션을 제거",async()=>{
  const calls=[];
  const api=new SupabaseApi(config,async(url,opts)=>{
    calls.push({url,opts});
    if(url.includes("/token?")) return reply(200,{access_token:"teacher-jwt",refresh_token:"refresh",expires_in:3600});
    return reply(200,url.includes("teacher_rooms")?[]:null);
  });
  await api.login(" teacher@example.com ","password");
  assert.equal(api.isTeacher,true);
  assert.equal(calls[1].opts.headers.Authorization,"Bearer teacher-jwt");
  assert.equal(JSON.parse(calls[0].opts.body).email,"teacher@example.com");
  await api.logout();assert.equal(api.isTeacher,false);
});

test("만료된 교사 토큰의 동시 요청은 한 번만 갱신하고 새 토큰을 사용",async()=>{
  let refreshCount=0;const headers=[];
  const api=new SupabaseApi(config,async(url,opts)=>{
    if(url.includes("grant_type=refresh_token")){
      refreshCount++;await Promise.resolve();
      return reply(200,{access_token:"renewed-jwt",refresh_token:"new-refresh",expires_in:3600});
    }
    headers.push(opts.headers.Authorization);return reply(200,[]);
  });
  api.session={access_token:"expired",refresh_token:"old-refresh",expires_at:0};
  await Promise.all([api.teacherRooms(),api.teacherRooms()]);
  assert.equal(refreshCount,1);
  assert.deepEqual(headers,["Bearer renewed-jwt","Bearer renewed-jwt"]);
  await api.logout();
});
