const PREFIX = "binome:v1:";
const memory = new Map();
let blocked = false;
function getEngine(session) {
  try { return session ? globalThis.sessionStorage : globalThis.localStorage; } catch { return null; }
}
export function readStore(key, fallback = null, session = false) {
  const k = PREFIX + key;
  try {
    const raw = getEngine(session)?.getItem(k) ?? memory.get(k);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function writeStore(key, value, session = false) {
  const k = PREFIX + key;
  const raw = JSON.stringify(value);
  memory.set(k, raw);
  try {
    const engine = getEngine(session);
    if (!engine) { blocked = true; return false; }
    engine.setItem(k, raw);
    return true;
  } catch { blocked = true; return false; }
}
export function removeStore(key, session = false) {
  memory.delete(PREFIX + key);
  try { getEngine(session)?.removeItem(PREFIX + key); } catch { /* 메모리 사본은 제거됨 */ }
}
export function storageBlocked() { return blocked; }
export function safeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error("이 브라우저는 지원되지 않아요. 최신 Chrome 또는 Safari를 사용해 주세요.");
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
