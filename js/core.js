import { QUESTIONS, LETTERS } from "./questions.js";

export function cleanName(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}
export function validateName(value) {
  const name = cleanName(value);
  if (!name) return "짝의 이름을 입력해 주세요.";
  if ([...name].length > 24) return "이름은 24자 이내로 입력해 주세요.";
  if (/[\u0000-\u001f\u007f]/u.test(name)) return "이름에 줄바꿈이나 제어 문자를 넣을 수 없어요.";
  return "";
}
export function cleanCode(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9]/gu, "").toUpperCase();
}
export function formatCode(value) {
  return cleanCode(value).match(/.{1,4}/gu)?.join("-") || "";
}
export function isComplete(answers) {
  return Array.isArray(answers) && answers.length === QUESTIONS.length &&
    QUESTIONS.every((q, i) => Number.isInteger(answers[i]) && answers[i] >= 0 && answers[i] < q.options.length);
}
export function completedResponses(responses) {
  return (Array.isArray(responses) ? responses : []).filter(r => r && typeof r.id === "string" &&
    typeof r.name === "string" && r.submitted_at && isComplete(r.answers));
}
export function sortNames(a, b) {
  return a.name.localeCompare(b.name, "ko", { numeric: true }) || a.id.localeCompare(b.id);
}
export function summarize(responses) {
  const rows = completedResponses(responses);
  return QUESTIONS.map((q, qi) => ({
    id: q.id, total: rows.length,
    counts: q.options.map((_, oi) => rows.reduce((sum, r) => sum + Number(r.answers[qi] === oi), 0)),
    percentages: q.options.map((_, oi) => rows.length ?
      Math.round(rows.filter(r => r.answers[qi] === oi).length * 100 / rows.length) : 0)
  }));
}
export function findMatches(responses, selectedId) {
  const rows = completedResponses(responses);
  const me = rows.find(r => r.id === selectedId);
  if (!me) return { me: null, score: null, matches: [] };
  const scored = rows.filter(r => r.id !== me.id).map(friend => ({
    ...friend, shared: me.answers.flatMap((a, i) => a === friend.answers[i] ? [i] : [])
  }));
  if (!scored.length) return { me, score: null, matches: [] };
  const score = Math.max(...scored.map(r => r.shared.length));
  return { me, score, matches: scored.filter(r => r.shared.length === score).sort(sortNames) };
}
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
export function csvCell(value) {
  let s = String(value ?? "");
  // 스프레드시트에서 이름을 수식으로 실행하지 않도록 처리합니다.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(s)) s = "'" + s;
  return '"' + s.replace(/"/gu, '""') + '"';
}
export function toCsv(responses) {
  const rows = completedResponses(responses).sort(sortNames);
  const data = [
    ["이름", ...QUESTIONS.map(q => q.short), "최초 제출 시각 (ISO)", "마지막 수정 시각 (ISO)"],
    ...rows.map(r => [r.name, ...r.answers.map((a, i) =>
      `${LETTERS[a]}. ${QUESTIONS[i].options[a].fr} / ${QUESTIONS[i].options[a].ko}`), r.submitted_at, r.updated_at])
  ];
  return "\uFEFF" + data.map(row => row.map(csvCell).join(",")).join("\r\n");
}
export function answerPhrase(question, answer) {
  const selected = question.options[answer];
  if (!selected) return "________________";
  return selected.fr.charAt(0).toLocaleLowerCase("fr") + selected.fr.slice(1);
}
export function checkConfig(raw = {}) {
  const url = String(raw.supabaseUrl || "").trim().replace(/\/+$/u, "");
  const key = String(raw.supabaseKey || "").trim();
  const pollIntervalMs = Math.max(5000, Number(raw.pollIntervalMs) || 10000);
  if (!url && !key) return { mode: "demo", pollIntervalMs };
  if (!url || !key) throw new Error("config.js의 Supabase URL과 공개 키를 모두 입력해 주세요.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Supabase URL은 https://프로젝트.supabase.co 형식이어야 해요.");
  }
  if (key.startsWith("sb_secret_")) throw new Error("공개 키가 필요해요. secret 키는 사용할 수 없어요.");
  if (!key.startsWith("sb_publishable_")) {
    let role;
    try { role = JSON.parse(atob(key.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/"))).role; }
    catch { throw new Error("올바른 Supabase publishable 키 또는 anon 키를 입력해 주세요."); }
    if (role !== "anon") throw new Error("브라우저에는 anon 키만 사용할 수 있어요. service_role 키는 사용할 수 없어요.");
  }
  return { mode: "connected", url, key, pollIntervalMs };
}
