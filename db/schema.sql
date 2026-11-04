-- Binôme 1.0 / Supabase PostgreSQL. SQL Editor에서 전체를 한 번 실행합니다.
-- 기존 프로젝트의 다른 테이블/함수/기본 권한은 변경하지 않습니다.
begin;

create schema if not exists binome_private;
revoke all on schema binome_private from public, anon, authenticated;

create table if not exists binome_private.teachers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists binome_private.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  code text not null unique check (code ~ '^[A-F0-9]{12}$'),
  is_open boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists binome_rooms_owner_idx on binome_private.rooms(owner_id);
create table if not exists binome_private.responses (
  id uuid primary key,
  room_id uuid not null references binome_private.rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24 and name !~ '[[:cntrl:]]'),
  name_key text not null,
  edit_token_hash text not null,
  answers smallint[],
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(room_id, name_key),
  check (answers is null or (
    array_ndims(answers) = 1 and array_lower(answers, 1) = 1 and cardinality(answers) = 5
    and array_position(answers, null) is null
    and answers[1] in (0,1,2,3) and answers[2] in (0,1,2,3)
    and answers[3] in (0,1) and answers[4] in (0,1) and answers[5] in (0,1)
  )),
  check ((submitted_at is null and answers is null) or (submitted_at is not null and answers is not null))
);
create index if not exists binome_responses_room_idx on binome_private.responses(room_id);
alter table binome_private.teachers enable row level security;
alter table binome_private.rooms enable row level security;
alter table binome_private.responses enable row level security;
revoke all on all tables in schema binome_private from public, anon, authenticated;

-- 비공개 내부 함수. 외부에 노출하지 않고 definer 함수에서만 사용합니다.
create or replace function binome_private.require_teacher()
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from binome_private.teachers where user_id = v_uid) then
    raise exception 'TEACHER_REQUIRED';
  end if;
  return v_uid;
end $$;

create or replace function binome_private.room_json(p_room binome_private.rooms)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id', (p_room).id, 'name', (p_room).name, 'code', (p_room).code,
    'is_open', (p_room).is_open, 'expires_at', (p_room).expires_at, 'created_at', (p_room).created_at);
$$;

create or replace function binome_private.response_json(p_response binome_private.responses)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id', (p_response).id, 'name', (p_response).name, 'answers', (p_response).answers,
    'version', (p_response).version, 'submitted_at', (p_response).submitted_at, 'updated_at', (p_response).updated_at);
$$;

create or replace function binome_private.lookup_room(p_code text, p_write boolean default false)
returns binome_private.rooms language plpgsql security invoker set search_path = '' as $$
declare v_room binome_private.rooms;
begin
  if p_write then
    select * into v_room from binome_private.rooms
    where code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')) for update;
  else
    select * into v_room from binome_private.rooms
    where code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  end if;
  if v_room.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.expires_at <= now() then raise exception 'ROOM_EXPIRED'; end if;
  if p_write and not v_room.is_open then raise exception 'ROOM_CLOSED'; end if;
  return v_room;
end $$;

-- 1. 학생: 반 확인
create or replace function public.binome_room(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room binome_private.rooms;
begin
  v_room := binome_private.lookup_room(p_code, false);
  return binome_private.room_json(v_room);
end $$;

-- 2. 학생: 짝 이름만 먼저 저장. 완료 전 응답은 대시보드에서 제외합니다.
create or replace function public.binome_reserve_partner(
  p_code text, p_response_id uuid, p_edit_token uuid, p_name text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room binome_private.rooms;
  v_response binome_private.responses;
  v_name text := btrim(regexp_replace(normalize(p_name, NFC), '[[:space:]]+', ' ', 'g'));
  v_hash text;
begin
  v_room := binome_private.lookup_room(p_code, true);
  if p_response_id is null or p_edit_token is null then raise exception 'INVALID_INPUT'; end if;
  if v_name is null or char_length(v_name) not between 1 and 24 or v_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID_NAME';
  end if;
  v_hash := encode(sha256(convert_to(p_edit_token::text, 'UTF8')), 'hex');
  select * into v_response from binome_private.responses where id = p_response_id for update;
  if found then
    if v_response.room_id <> v_room.id or v_response.edit_token_hash <> v_hash then
      raise exception 'NOT_OWNER';
    end if;
    if v_response.name <> v_name then
      update binome_private.responses set name = v_name, name_key = lower(v_name),
        version = version + 1, updated_at = now()
      where id = p_response_id returning * into v_response;
    end if;
  else
    -- 반 행을 잠근 상태이므로 동시 요청에서도 인원 제한을 지킵니다.
    if (select count(*) from binome_private.responses where room_id = v_room.id) >= 128 then
      raise exception 'CLASS_FULL';
    end if;
    insert into binome_private.responses(id, room_id, name, name_key, edit_token_hash)
    values (p_response_id, v_room.id, v_name, lower(v_name), v_hash) returning * into v_response;
  end if;
  return binome_private.response_json(v_response);
exception when unique_violation then raise exception 'NAME_TAKEN';
end $$;

-- 3. 학생: 다섯 답을 한 번에 제출. 수정할 때도 동일 응답을 갱신합니다.
create or replace function public.binome_submit_response(
  p_code text, p_response_id uuid, p_edit_token uuid, p_answers smallint[], p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room binome_private.rooms; v_response binome_private.responses;
begin
  v_room := binome_private.lookup_room(p_code, true);
  if p_edit_token is null or p_response_id is null then raise exception 'INVALID_INPUT'; end if;
  if p_answers is null or array_ndims(p_answers) is distinct from 1 or array_lower(p_answers,1) is distinct from 1
    or cardinality(p_answers) is distinct from 5 or array_position(p_answers,null) is not null
    or p_answers[1] not in (0,1,2,3) or p_answers[2] not in (0,1,2,3)
    or p_answers[3] not in (0,1) or p_answers[4] not in (0,1) or p_answers[5] not in (0,1) then
    raise exception 'INVALID_ANSWERS';
  end if;
  select * into v_response from binome_private.responses
    where id = p_response_id and room_id = v_room.id for update;
  if not found then raise exception 'RESPONSE_NOT_FOUND'; end if;
  if v_response.edit_token_hash <> encode(sha256(convert_to(p_edit_token::text, 'UTF8')), 'hex') then
    raise exception 'NOT_OWNER';
  end if;
  -- 응답 유실 후 같은 요청을 다시 보내도 중복/충돌 없이 성공합니다.
  if v_response.submitted_at is not null and v_response.answers = p_answers then
    return binome_private.response_json(v_response);
  end if;
  if p_expected_version is distinct from v_response.version then raise exception 'EDIT_CONFLICT'; end if;
  update binome_private.responses set answers = p_answers, version = version + 1,
    submitted_at = coalesce(submitted_at, now()), updated_at = now()
    where id = p_response_id returning * into v_response;
  return binome_private.response_json(v_response);
end $$;

-- 4. 학생: 해당 반에서 최종 제출한 응답만 조회. 편집 토큰/교사 정보는 반환하지 않습니다.
create or replace function public.binome_dashboard(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room binome_private.rooms; v_rows jsonb;
begin
  v_room := binome_private.lookup_room(p_code, false);
  select coalesce(jsonb_agg(binome_private.response_json(r) order by r.name), '[]'::jsonb)
    into v_rows from binome_private.responses r where room_id = v_room.id and submitted_at is not null;
  return jsonb_build_object('room', binome_private.room_json(v_room), 'responses', v_rows, 'fetched_at', now());
end $$;

-- 교사 API: Auth 로그인과 교사 허용 목록, 반 소유자를 모두 확인합니다.
create or replace function public.binome_create_room(p_name text, p_days integer default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_room binome_private.rooms; v_code text; v_name text := btrim(p_name);
begin
  v_uid := binome_private.require_teacher();
  if v_name is null or char_length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]'
    or p_days is null or p_days not between 1 and 30 then raise exception 'INVALID_INPUT'; end if;
  -- 교사별 생성을 직렬화하여 동시 요청으로 개수 제한을 넘지 못하게 합니다.
  perform 1 from binome_private.teachers where user_id = v_uid for update;
  if (select count(*) from binome_private.rooms where owner_id = v_uid) >= 50 then raise exception 'ROOM_LIMIT'; end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    exit when not exists(select 1 from binome_private.rooms where code = v_code);
  end loop;
  insert into binome_private.rooms(owner_id, name, code, expires_at)
    values (v_uid, v_name, v_code, now() + make_interval(days => p_days)) returning * into v_room;
  return binome_private.room_json(v_room);
end $$;

create or replace function public.binome_teacher_rooms()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_rows jsonb;
begin
  v_uid := binome_private.require_teacher();
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb) into v_rows
  from (
    select r.created_at, binome_private.room_json(r) || jsonb_build_object(
      'total', (select count(*) from binome_private.responses s where s.room_id = r.id and s.submitted_at is not null),
      'draft_count', (select count(*) from binome_private.responses s where s.room_id = r.id and s.submitted_at is null)
    ) as item from binome_private.rooms r where r.owner_id = v_uid
  ) t;
  return v_rows;
end $$;

create or replace function public.binome_teacher_dashboard(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_room binome_private.rooms; v_rows jsonb; v_drafts jsonb;
begin
  v_uid := binome_private.require_teacher();
  select * into v_room from binome_private.rooms where id = p_room_id and owner_id = v_uid;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(binome_private.response_json(r) order by r.name), '[]'::jsonb)
    into v_rows from binome_private.responses r where room_id = v_room.id and submitted_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name), '[]'::jsonb)
    into v_drafts from binome_private.responses r where room_id = v_room.id and submitted_at is null;
  return jsonb_build_object('room', binome_private.room_json(v_room), 'responses', v_rows,
    'drafts', v_drafts, 'fetched_at', now());
end $$;

create or replace function public.binome_set_room_open(p_room_id uuid, p_is_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_room binome_private.rooms;
begin
  v_uid := binome_private.require_teacher();
  if p_is_open is null then raise exception 'INVALID_INPUT'; end if;
  update binome_private.rooms set is_open = p_is_open where id = p_room_id and owner_id = v_uid returning * into v_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  return binome_private.room_json(v_room);
end $$;

create or replace function public.binome_delete_response(p_room_id uuid, p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := binome_private.require_teacher();
  perform 1 from binome_private.rooms where id = p_room_id and owner_id = v_uid for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  delete from binome_private.responses where id = p_response_id and room_id = p_room_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.binome_delete_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := binome_private.require_teacher();
  delete from binome_private.rooms where id = p_room_id and owner_id = v_uid;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- PRIVATE 함수와 테이블은 직접 호출/열람 불가. 공개 API만 역할별 허용.
revoke all on all functions in schema binome_private from public, anon, authenticated;
revoke all on function public.binome_room(text) from public, anon, authenticated;
revoke all on function public.binome_reserve_partner(text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.binome_submit_response(text,uuid,uuid,smallint[],integer) from public, anon, authenticated;
revoke all on function public.binome_dashboard(text) from public, anon, authenticated;
revoke all on function public.binome_create_room(text,integer) from public, anon, authenticated;
revoke all on function public.binome_teacher_rooms() from public, anon, authenticated;
revoke all on function public.binome_teacher_dashboard(uuid) from public, anon, authenticated;
revoke all on function public.binome_set_room_open(uuid,boolean) from public, anon, authenticated;
revoke all on function public.binome_delete_response(uuid,uuid) from public, anon, authenticated;
revoke all on function public.binome_delete_room(uuid) from public, anon, authenticated;
grant execute on function public.binome_room(text), public.binome_reserve_partner(text,uuid,uuid,text),
  public.binome_submit_response(text,uuid,uuid,smallint[],integer), public.binome_dashboard(text) to anon, authenticated;
grant execute on function public.binome_create_room(text,integer), public.binome_teacher_rooms(),
  public.binome_teacher_dashboard(uuid), public.binome_set_room_open(uuid,boolean),
  public.binome_delete_response(uuid,uuid), public.binome_delete_room(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
