import { cleanCode } from "./core.js";
import { readStore, writeStore, removeStore } from "./storage.js";

const ERRORS = {
  ROOM_NOT_FOUND: "반 코드를 찾지 못했어요. 선생님이 알려 준 코드를 확인해 주세요.",
  ROOM_CLOSED: "지금은 제출이 마감됐어요. 작성한 답변은 이 기기에 남아 있어요.",
  ROOM_EXPIRED: "이 활동의 참여 기간이 끝났어요. 선생님께 새 반 코드를 확인해 주세요.",
  NAME_TAKEN: "이미 등록된 이름이에요. 이 기기에서 작성했다면 ‘기록한 응답 수정’을 선택해 주세요. 동명이인은 이름 뒤에 번호를 붙여 주세요.",
  INVALID_NAME: "이름은 줄바꿈 없이 1~24자로 입력해 주세요.",
  INVALID_ANSWERS: "다섯 질문의 답을 모두 선택해 주세요.",
  RESPONSE_NOT_FOUND: "이 응답을 찾을 수 없어요. 선생님이 삭제했다면 새로 시작해 주세요.",
  NOT_OWNER: "이 응답은 작성했던 기기에서 수정할 수 있어요.",
  EDIT_CONFLICT: "다른 탭에서 답변이 변경됐어요. 홈의 ‘기록한 응답 수정’으로 최신 응답을 다시 불러와 주세요.",
  TEACHER_REQUIRED: "교사 권한이 없는 계정이에요. DB에 교사 계정을 등록했는지 확인해 주세요.",
  ROOM_LIMIT: "만들 수 있는 활동 수를 초과했어요. 사용하지 않는 반을 삭제해 주세요.",
  CLASS_FULL: "이 활동의 등록 가능 인원을 초과했어요. 선생님께 알려 주세요.",
  INVALID_INPUT: "입력값을 확인해 주세요.",
  AUTH_REQUIRED: "교사 로그인이 만료됐어요. 다시 로그인해 주세요."
};
export class ApiError extends Error {
  constructor(code, message = "") { super(message || ERRORS[code] || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."); this.code = code; }
}
export function friendlyError(error) {
  return error?.message || "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

export class SupabaseApi {
  constructor(config, fetcher = globalThis.fetch.bind(globalThis)) {
    this.config = config;
    this.fetcher = fetcher;
    this.session = readStore("teacher-session", null, true);
    this.refreshing = null;
  }
  get isTeacher() { return Boolean(this.session?.access_token); }
  async request(path, body, token = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const headers = { apikey: this.config.key, "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await this.fetcher(this.config.url + path, {
        method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
        credentials: "omit", cache: "no-store"
      });
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : null; } catch { throw new ApiError("BAD_RESPONSE", "서버 응답 형식을 확인해 주세요. Supabase 주소가 올바른지 확인해 주세요."); }
      if (!response.ok) {
        const known = Object.keys(ERRORS).find(code => String(data?.message || "").includes(code));
        if (known) throw new ApiError(known);
        if (path.startsWith("/auth/")) {
          if (response.status === 429) throw new ApiError("RATE_LIMIT", "로그인 요청이 많아요. 잠시 후 다시 시도해 주세요.");
          throw new ApiError("LOGIN_FAILED", "로그인하지 못했어요. 이메일과 비밀번호 또는 로그인 상태를 확인해 주세요.");
        }
        if (response.status === 401 || response.status === 403) throw new ApiError("AUTH_REQUIRED");
        if (data?.code === "PGRST202") throw new ApiError("SCHEMA_MISSING", "DB 함수가 준비되지 않았어요. db/schema.sql을 실행했는지 확인해 주세요.");
        throw new ApiError("SERVER_ERROR", "서버 요청에 실패했어요. DB 설정과 인터넷 연결을 확인해 주세요.");
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("NETWORK_ERROR", error?.name === "AbortError" ?
        "응답이 늦어지고 있어요. 저장 여부가 불확실하면 같은 화면에서 다시 시도해 주세요." :
        "인터넷 연결을 확인해 주세요. 작성한 답변은 이 기기에 남아 있어요.");
    } finally { clearTimeout(timer); }
  }
  rpc(name, args, token = null) { return this.request("/rest/v1/rpc/" + name, args, token); }
  room(code) { return this.rpc("binome_room", { p_code: cleanCode(code) }); }
  reserve(code, draft) {
    return this.rpc("binome_reserve_partner", { p_code: cleanCode(code), p_response_id: draft.id,
      p_edit_token: draft.token, p_name: draft.name });
  }
  submit(code, draft) {
    return this.rpc("binome_submit_response", { p_code: cleanCode(code), p_response_id: draft.id,
      p_edit_token: draft.token, p_answers: draft.answers, p_expected_version: draft.version });
  }
  dashboard(code) { return this.rpc("binome_dashboard", { p_code: cleanCode(code) }); }
  async login(email, password) {
    const result = await this.request("/auth/v1/token?grant_type=password", { email: email.trim(), password });
    this.storeSession(result);
    try { await this.teacherRooms(); } catch (error) { await this.logout(); throw error; }
  }
  storeSession(value) {
    this.session = { access_token: value.access_token, refresh_token: value.refresh_token,
      expires_at: value.expires_at || Math.floor(Date.now() / 1000) + value.expires_in };
    writeStore("teacher-session", this.session, true);
  }
  async teacherToken() {
    if (!this.session) throw new ApiError("AUTH_REQUIRED");
    if (this.session.expires_at > Date.now() / 1000 + 60) return this.session.access_token;
    if (!this.refreshing) {
      this.refreshing = this.request("/auth/v1/token?grant_type=refresh_token", { refresh_token: this.session.refresh_token })
        .then(data => { this.storeSession(data); return this.session.access_token; })
        .catch(error => { this.session = null; removeStore("teacher-session", true); throw error; })
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async teacherRpc(name, args = {}) { return this.rpc(name, args, await this.teacherToken()); }
  teacherRooms() { return this.teacherRpc("binome_teacher_rooms"); }
  createRoom(name, days) { return this.teacherRpc("binome_create_room", { p_name: name, p_days: days }); }
  setOpen(id, value) { return this.teacherRpc("binome_set_room_open", { p_room_id: id, p_is_open: value }); }
  teacherDashboard(id) { return this.teacherRpc("binome_teacher_dashboard", { p_room_id: id }); }
  deleteResponse(roomId, id) { return this.teacherRpc("binome_delete_response", { p_room_id: roomId, p_response_id: id }); }
  deleteRoom(id) { return this.teacherRpc("binome_delete_room", { p_room_id: id }); }
  async logout() {
    const token = this.session?.access_token;
    this.session = null; removeStore("teacher-session", true);
    if (token) { try { await this.request("/auth/v1/logout", {}, token); } catch { /* 로컬 세션은 이미 삭제 */ } }
  }
}
