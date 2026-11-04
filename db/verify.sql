-- 교사 권한 등록 후 Supabase SQL Editor에서 전체 실행합니다.
-- 검증용 반/응답은 이 트랜잭션에서만 만들고 끝에 모두 롤백합니다.
begin;
do $$
declare
  v_teacher uuid;
  v_room jsonb;
  v_other jsonb;
  v_response jsonb;
  v_result jsonb;
  v_id uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_code text;
  v_room_id uuid;
begin
  select user_id into v_teacher from binome_private.teachers limit 1;
  if v_teacher is null then raise exception '먼저 db/allow-teacher.sql.example로 교사를 등록하세요.'; end if;
  perform set_config('request.jwt.claim.sub', v_teacher::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_teacher,'role','authenticated')::text, true);

  if has_schema_privilege('anon','binome_private','USAGE')
    or has_table_privilege('anon','binome_private.responses','SELECT')
    or has_table_privilege('authenticated','binome_private.responses','UPDATE') then
    raise exception 'FAIL: 직접 테이블 접근 권한이 있습니다.';
  end if;
  if has_function_privilege('anon','public.binome_create_room(text,integer)','EXECUTE')
    or not has_function_privilege('anon','public.binome_dashboard(text)','EXECUTE') then
    raise exception 'FAIL: API 함수 실행 권한이 올바르지 않습니다.';
  end if;

  v_room := public.binome_create_room('검증용 반 — 롤백 예정',1);
  v_code := v_room->>'code'; v_room_id := (v_room->>'id')::uuid;
  v_other := public.binome_create_room('검증용 다른 반 — 롤백 예정',1);
  if v_code !~ '^[A-F0-9]{12}$' then raise exception 'FAIL: 반 코드 형식'; end if;

  v_response := public.binome_reserve_partner(v_code,v_id,v_token,'검증 학생');
  if v_response->>'name' <> '검증 학생' then raise exception 'FAIL: 이름 저장'; end if;
  v_result := public.binome_dashboard(v_code);
  if jsonb_array_length(v_result->'responses') <> 0 then raise exception 'FAIL: 미완료 응답이 공개됨'; end if;

  begin
    perform public.binome_reserve_partner(v_code,gen_random_uuid(),gen_random_uuid(),'검증 학생');
    raise exception 'FAIL: 중복 이름을 허용함';
  exception when others then
    if SQLERRM <> 'NAME_TAKEN' then raise; end if;
  end;
  begin
    perform public.binome_submit_response(v_code,v_id,v_token,array[0,0,2,0,0]::smallint[],0);
    raise exception 'FAIL: 보기 범위 오류를 허용함';
  exception when others then
    if SQLERRM <> 'INVALID_ANSWERS' then raise; end if;
  end;
  begin
    perform public.binome_submit_response(v_code,v_id,v_token,array[0,0,null,0,0]::smallint[],0);
    raise exception 'FAIL: null 답변을 허용함';
  exception when others then
    if SQLERRM <> 'INVALID_ANSWERS' then raise; end if;
  end;
  begin
    perform public.binome_submit_response(v_code,v_id,gen_random_uuid(),array[0,0,0,0,0]::smallint[],0);
    raise exception 'FAIL: 다른 편집 토큰을 허용함';
  exception when others then
    if SQLERRM <> 'NOT_OWNER' then raise; end if;
  end;

  v_response := public.binome_submit_response(v_code,v_id,v_token,array[0,0,0,0,0]::smallint[],0);
  if (v_response->>'version')::integer <> 1 then raise exception 'FAIL: 최초 제출 버전'; end if;
  v_response := public.binome_submit_response(v_code,v_id,v_token,array[0,0,0,0,0]::smallint[],0);
  if (v_response->>'version')::integer <> 1 then raise exception 'FAIL: 재전송이 중복 갱신됨'; end if;
  begin
    perform public.binome_submit_response(v_code,v_id,v_token,array[1,0,0,0,0]::smallint[],0);
    raise exception 'FAIL: 오래된 버전으로 수정됨';
  exception when others then
    if SQLERRM <> 'EDIT_CONFLICT' then raise; end if;
  end;
  v_response := public.binome_submit_response(v_code,v_id,v_token,array[1,0,0,0,0]::smallint[],1);
  v_result := public.binome_dashboard(v_code);
  if jsonb_array_length(v_result->'responses') <> 1 then raise exception 'FAIL: 수정 시 인원 중복'; end if;
  if (v_result->'responses'->0->'answers'->>0)::integer <> 1 then raise exception 'FAIL: 수정 답변 누락'; end if;
  if v_result::text like '%edit_token%' then raise exception 'FAIL: 편집 토큰 정보 노출'; end if;
  if jsonb_array_length(public.binome_dashboard(v_other->>'code')->'responses') <> 0 then raise exception 'FAIL: 반별 분리'; end if;

  perform public.binome_set_room_open(v_room_id,false);
  begin
    perform public.binome_submit_response(v_code,v_id,v_token,array[1,0,0,0,0]::smallint[],2);
    raise exception 'FAIL: 마감 후 제출 허용';
  exception when others then
    if SQLERRM <> 'ROOM_CLOSED' then raise; end if;
  end;
  if jsonb_array_length(public.binome_dashboard(v_code)->'responses') <> 1 then raise exception 'FAIL: 마감 시 기존 결과 유실'; end if;

  perform public.binome_delete_response(v_room_id,v_id);
  if jsonb_array_length(public.binome_dashboard(v_code)->'responses') <> 0 then raise exception 'FAIL: 응답 삭제'; end if;
  perform public.binome_delete_room(v_room_id);
  begin
    perform public.binome_room(v_code);
    raise exception 'FAIL: 삭제된 반 조회 허용';
  exception when others then
    if SQLERRM <> 'ROOM_NOT_FOUND' then raise; end if;
  end;
  raise notice 'Binôme DB smoke checks passed. 모든 검증용 변경을 롤백합니다.';
end $$;
rollback;
