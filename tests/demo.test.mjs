import test from "node:test";
import assert from "node:assert/strict";
import { DemoApi } from "../js/demo.js";
import { safeUuid } from "../js/storage.js";

test("짝 이름 저장 → 미완료 제외 → 최종 제출 → 수정해도 중복 없이 갱신 → 반 분리",async()=>{
  const api=new DemoApi(); await api.login();
  const room=await api.createRoom("검증 전용 반",7);
  const other=await api.createRoom("다른 반",7);
  const draft={id:safeUuid(),token:safeUuid(),name:"테스트 친구",answers:[0,1,0,1,0],version:0};
  const reserved=await api.reserve(room.code,draft);
  assert.equal(reserved.name,draft.name);
  assert.equal((await api.dashboard(room.code)).responses.length,0);
  assert.equal((await api.teacherDashboard(room.id)).drafts.length,1);
  const submitted=await api.submit(room.code,draft);
  assert.equal((await api.dashboard(room.code)).responses.length,1);
  assert.equal((await api.dashboard(other.code)).responses.length,0);
  const replay=await api.submit(room.code,draft);
  assert.equal(replay.version,submitted.version);
  const modified={...draft,version:submitted.version,answers:[3,2,1,0,1]};
  const updated=await api.submit(room.code,modified);
  assert.equal(updated.version,submitted.version+1);
  assert.deepEqual((await api.dashboard(room.code)).responses[0].answers,modified.answers);
  assert.equal((await api.dashboard(room.code)).responses.length,1);
});
test("다른 편집 토큰, 중복 이름, 버전 충돌, 미응답을 거부",async()=>{
  const api=new DemoApi(); await api.login(); const room=await api.createRoom("보호 검증",7);
  const draft={id:safeUuid(),token:safeUuid(),name:"소유자",answers:[0,0,0,0,0],version:0};
  await api.reserve(room.code,draft);
  await assert.rejects(()=>api.submit(room.code,{...draft,token:safeUuid()}),e=>e.code==="NOT_OWNER");
  await assert.rejects(()=>api.reserve(room.code,{...draft,id:safeUuid(),token:safeUuid()}),e=>e.code==="NAME_TAKEN");
  await assert.rejects(()=>api.submit(room.code,{...draft,answers:[0,0,null,0,0]}),e=>e.code==="INVALID_ANSWERS");
  await api.submit(room.code,draft);
  await assert.rejects(()=>api.submit(room.code,{...draft,answers:[1,0,0,0,0]}),e=>e.code==="EDIT_CONFLICT");
});
test("마감은 제출만 차단, 대시보드 조회 가능, 교사 삭제는 해당 반에만 적용",async()=>{
  const api=new DemoApi(); await api.login(); const room=await api.createRoom("마감 검증",7);
  const draft={id:safeUuid(),token:safeUuid(),name:"짝",answers:[0,0,0,0,0],version:0};
  await api.reserve(room.code,draft); await api.submit(room.code,draft);
  await api.setOpen(room.id,false);
  await assert.rejects(()=>api.submit(room.code,draft),e=>e.code==="ROOM_CLOSED");
  assert.equal((await api.dashboard(room.code)).responses.length,1);
  await api.deleteResponse(room.id,draft.id);
  assert.equal((await api.dashboard(room.code)).responses.length,0);
  await api.deleteRoom(room.id);
  await assert.rejects(()=>api.room(room.code),e=>e.code==="ROOM_NOT_FOUND");
});
test("학생 대시보드에는 편집 토큰이 전달되지 않음",async()=>{
  const api=new DemoApi();await api.login();const room=await api.createRoom("공개 필드 검증",7);
  const draft={id:safeUuid(),token:safeUuid(),name:"토큰 보호",answers:[0,0,0,0,0],version:0};
  await api.reserve(room.code,draft);await api.submit(room.code,draft);
  const result=await api.dashboard(room.code);
  assert.equal(result.responses[0].token,undefined);
  assert.equal(result.responses[0].edit_token_hash,undefined);
});
