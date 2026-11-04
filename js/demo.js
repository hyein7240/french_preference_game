import { cleanCode, cleanName, validateName, isComplete, sortNames } from "./core.js";
import { readStore, writeStore, safeUuid } from "./storage.js";
import { ApiError } from "./api.js";

export const DEMO_CODE = "B10B20260001";
const DB_KEY = "demo-database";
function initialData() {
  const now = new Date().toISOString();
  const room = { id: "demo-room", name: "1학년 3반 · 체험", code: DEMO_CODE, is_open: true,
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), created_at: now };
  const answers = [[0,0,1,0,1],[1,2,0,0,0],[0,0,1,0,1],[3,0,1,1,1],
    [2,2,0,0,0],[1,1,1,1,0],[0,0,1,0,1],[3,3,0,1,1]];
  const names = ["민서", "서준", "지우", "하린", "도윤", "예은", "유진", "현우"];
  return { rooms: [room], responses: names.map((name, i) => ({ id: `demo-student-${i+1}`, room_id: room.id,
    name, token: "fixture-only", answers: answers[i], version: 1, submitted_at: now, updated_at: now })) };
}
function db() {
  let data = readStore(DB_KEY);
  if (!data || !Array.isArray(data.rooms) || !Array.isArray(data.responses)) {
    data = initialData(); writeStore(DB_KEY, data);
  }
  return data;
}
function publicRow(row) {
  const { token, room_id, ...safe } = row;
  return safe;
}
function lookup(data, code, write = false) {
  const room = data.rooms.find(r => r.code === cleanCode(code));
  if (!room) throw new ApiError("ROOM_NOT_FOUND");
  if (Date.parse(room.expires_at) <= Date.now()) throw new ApiError("ROOM_EXPIRED");
  if (write && !room.is_open) throw new ApiError("ROOM_CLOSED");
  return room;
}
export class DemoApi {
  constructor() { this.loggedIn = false; db(); }
  get isTeacher() { return this.loggedIn; }
  async room(code) { return { ...lookup(db(), code) }; }
  async reserve(code, draft) {
    const data = db(); const room = lookup(data, code, true); const name = cleanName(draft.name);
    if (validateName(name)) throw new ApiError("INVALID_NAME");
    let row = data.responses.find(r => r.id === draft.id);
    if (row && (row.room_id !== room.id || row.token !== draft.token)) throw new ApiError("NOT_OWNER");
    if (data.responses.some(r => r.room_id === room.id && r.id !== draft.id && r.name.toLowerCase() === name.toLowerCase())) throw new ApiError("NAME_TAKEN");
    if (!row) {
      if (data.responses.filter(r => r.room_id === room.id).length >= 128) throw new ApiError("CLASS_FULL");
      row = { id: draft.id, token: draft.token, room_id: room.id, name, answers: null,
        version: 0, submitted_at: null, updated_at: new Date().toISOString() };
      data.responses.push(row);
    } else if (row.name !== name) { row.name = name; row.version++; }
    writeStore(DB_KEY, data); return publicRow(row);
  }
  async submit(code, draft) {
    const data = db(); const room = lookup(data, code, true);
    const row = data.responses.find(r => r.id === draft.id && r.room_id === room.id);
    if (!row) throw new ApiError("RESPONSE_NOT_FOUND");
    if (row.token !== draft.token) throw new ApiError("NOT_OWNER");
    if (!isComplete(draft.answers)) throw new ApiError("INVALID_ANSWERS");
    if (row.submitted_at && JSON.stringify(row.answers) === JSON.stringify(draft.answers)) return publicRow(row);
    if (row.version !== draft.version) throw new ApiError("EDIT_CONFLICT");
    row.answers = [...draft.answers]; row.version++;
    row.updated_at = new Date().toISOString(); row.submitted_at ||= row.updated_at;
    writeStore(DB_KEY, data); return publicRow(row);
  }
  async dashboard(code) {
    const data = db(); const room = lookup(data, code);
    return { room: { ...room }, responses: data.responses.filter(r => r.room_id === room.id && r.submitted_at)
      .map(publicRow).sort(sortNames), fetched_at: new Date().toISOString() };
  }
  async login() { this.loggedIn = true; }
  async logout() { this.loggedIn = false; }
  requireTeacher() { if (!this.loggedIn) throw new ApiError("AUTH_REQUIRED"); }
  async teacherRooms() {
    this.requireTeacher(); const data = db();
    return data.rooms.map(room => ({ ...room,
      total: data.responses.filter(r => r.room_id === room.id && r.submitted_at).length,
      draft_count: data.responses.filter(r => r.room_id === room.id && !r.submitted_at).length
    })).sort((a,b) => b.created_at.localeCompare(a.created_at));
  }
  async createRoom(name, days) {
    this.requireTeacher(); const data = db();
    const room = { id: safeUuid(), name: name.trim(), code: safeUuid().replace(/-/gu, "").slice(0,12).toUpperCase(),
      is_open: true, expires_at: new Date(Date.now()+ days*86400000).toISOString(), created_at: new Date().toISOString() };
    data.rooms.unshift(room); writeStore(DB_KEY, data); return room;
  }
  async teacherDashboard(id) {
    this.requireTeacher(); const data = db(); const room = data.rooms.find(r => r.id === id);
    if (!room) throw new ApiError("ROOM_NOT_FOUND");
    const rows = data.responses.filter(r => r.room_id === id);
    return { room: { ...room }, responses: rows.filter(r=>r.submitted_at).map(publicRow),
      drafts: rows.filter(r=>!r.submitted_at).map(r=>({id:r.id,name:r.name})), fetched_at:new Date().toISOString() };
  }
  async setOpen(id, value) {
    this.requireTeacher(); const data = db(); const room = data.rooms.find(r=>r.id===id);
    if (!room) throw new ApiError("ROOM_NOT_FOUND");
    room.is_open = value; writeStore(DB_KEY,data); return room;
  }
  async deleteResponse(roomId, id) {
    this.requireTeacher(); const data = db(); data.responses = data.responses.filter(r=>r.room_id!==roomId || r.id!==id);
    writeStore(DB_KEY,data); return {ok:true};
  }
  async deleteRoom(id) {
    this.requireTeacher(); const data=db(); data.rooms=data.rooms.filter(r=>r.id!==id);
    data.responses=data.responses.filter(r=>r.room_id!==id); writeStore(DB_KEY,data); return {ok:true};
  }
}
