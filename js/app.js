import { QUESTIONS, LETTERS } from "./questions.js";
import { cleanName, validateName, cleanCode, formatCode, isComplete, completedResponses,
  sortNames, summarize, findMatches, escapeHtml, toCsv, answerPhrase, checkConfig } from "./core.js";
import { readStore, writeStore, storageBlocked, safeUuid } from "./storage.js";
import { SupabaseApi, friendlyError } from "./api.js";
import { DemoApi, DEMO_CODE } from "./demo.js";

const e = escapeHtml;
const app = document.getElementById("app");
const PATHS = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4h2a8.5 8.5 0 0 1 8.5 7.5Z"/><path d="M7 11h9m-9 4h5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  edit: '<path d="m15 4 5 5-11 11-6 1 1-6L15 4Zm-9 9 5 5m3-13 5 5"/>',
  chart: '<path d="M4 3v17h17M9 16V9m5 7V5m5 11v-6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 11.5-2L20 8M4 16l2.5 3A7 7 0 0 0 18 17"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>'
};
function icon(name, size = 20, cls = "") {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.check}</svg>`;
}

let config;
try { config = checkConfig(window.BINOME_CONFIG || {}); }
catch (error) {
  app.innerHTML = `<main id="main" class="config-error card"><span class="eyebrow">Binôme</span><h1>연결 설정을 확인해 주세요.</h1><p>${e(error.message)}</p><p><code>config.js</code>와 배포 안내를 확인한 뒤 새로고침해 주세요.</p></main>`;
}
if (config) init();

function init() {
  const api = config.mode === "demo" ? new DemoApi() : new SupabaseApi(config);
  const storeKey = "client:" + (config.mode === "demo" ? "demo" : config.url);
  let client = readStore(storeKey, {});
  if (!client || typeof client !== "object" || Array.isArray(client)) client = {};
  client.drafts ||= {}; client.selectedByRoom ||= {};
  const incoming = cleanCode(new URL(location.href).searchParams.get("classe"));
  client.code = incoming || cleanCode(client.code) || cleanCode(window.BINOME_CONFIG?.classCode) || (config.mode === "demo" ? DEMO_CODE : "");
  const state = {
    view: "home", step: 0, error: "", busy: false, room: null, snapshot: null, refreshing: false,
    refreshError: "", lastFetch: null, autoRefresh: true, editingReview: false,
    teacherRoomId: null, teacherRooms: null, teacherLoading: false, showAllMatches: false,
    homeName: "", homeCode: formatCode(client.code), switchingRoom: false, teacherEmail: "", createName: "", createDays: "7"
  };
  let refreshPromise = null;
  let dashboardGeneration = 0;
  let toastTimer;
  let renderedView = "";
  let lastInteractionAt = 0;

  function persist() { writeStore(storeKey, client); }
  function draft() {
    const d = client.drafts[client.activeId];
    return d?.code === client.code ? d : null;
  }
  function owned() {
    return Object.values(client.drafts).filter(d => d && d.code === client.code && d.reserved)
      .sort((a,b) => String(b.touched || "").localeCompare(String(a.touched || "")));
  }
  function saveDraft(d) {
    d.touched = new Date().toISOString(); client.drafts[d.id] = d; client.activeId = d.id; persist();
  }
  function setCode(code) {
    const next = cleanCode(code);
    state.homeCode = formatCode(next);
    if (next !== client.code) {
      dashboardGeneration++; client.code = next; state.snapshot = null; state.room = null;
      state.lastFetch = null; state.refreshError = "";
    }
    persist();
  }
  function disabled() { return state.busy ? 'disabled aria-busy="true"' : ""; }
  function errorBox() {
    return state.error ? `<div class="form-error" id="form-error" role="alert" tabindex="-1">${icon("info",18)}<span>${e(state.error)}</span></div>` : "";
  }
  function announce(message) { document.getElementById("announcer").textContent = message; }
  function toast(message) {
    const el = document.getElementById("toast"); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }
  function focusError() { document.getElementById("form-error")?.focus(); }
  async function perform(work) {
    if (state.busy) return;
    state.error = ""; state.busy = true; render();
    try { await work(); }
    catch (error) { state.error = friendlyError(error); }
    finally { state.busy = false; render(); if (state.error) focusError(); }
  }
  function navigate(view, step = 0) {
    const hash = view === "home" ? "#/" : view === "interview" ? `#/interview/${step + 1}` : `#/${view}`;
    if (location.hash === hash) route(); else location.hash = hash;
  }
  function route() {
    const previousView = state.view;
    const parts = location.hash.replace(/^#\/?/u, "").split("/");
    const allowed = ["home", "interview", "review", "done", "dashboard", "teacher"];
    state.view = allowed.includes(parts[0]) ? parts[0] : "home";
    state.step = Math.max(0, Math.min(4, (Number(parts[1]) || 1) - 1));
    if (["interview","review","done"].includes(state.view) && !draft()) state.view = "home";
    if (state.view === "done" && (!draft()?.submitted_at || draft()?.dirty)) state.view = "review";
    state.error = "";
    if (previousView === "dashboard" && state.view !== "dashboard") dashboardGeneration++;
    render();
    document.querySelector("h1")?.focus({preventScroll:true});
    window.scrollTo({top:0,behavior:"instant"});
    if (state.view === "dashboard" && client.code && !state.switchingRoom) void refreshSnapshot(false);
    if (state.view === "teacher" && api.isTeacher) void loadTeacher();
  }

  function render() {
    const activeId = document.activeElement?.id;
    const sameView = renderedView === state.view;
    const openedDetails = Array.from(document.querySelectorAll?.("details[open]") || []).map(el=>el.id).filter(Boolean);
    const navActive = ["interview","review","done"].includes(state.view) ? "home" : state.view;
    let page;
    if (state.view === "interview") page = renderQuestion();
    else if (state.view === "review") page = renderReview();
    else if (state.view === "done") page = renderDone();
    else if (state.view === "dashboard") page = renderDashboard();
    else if (state.view === "teacher") page = renderTeacher();
    else page = renderHome();
    app.innerHTML = `<div class="app-shell">
      <header class="site-header">
        <a class="brand" href="#/" aria-label="홈"><img src="./assets/logo.svg" alt=""><span class="brand-name"><span class="brand-caption">너와 나, 우리의 취향</span></span></a>
        <nav class="main-nav" aria-label="주 메뉴">
          <a class="nav-link ${navActive === "home" ? "active" : ""}" href="#/" ${navActive === "home" ? 'aria-current="page"' : ""}>${icon("chat",17)}짝 인터뷰</a>
          <a class="nav-link ${navActive === "dashboard" ? "active" : ""}" href="#/dashboard" ${navActive === "dashboard" ? 'aria-current="page"' : ""}>${icon("chart",17)}우리 반 대시보드</a>
        </nav>
        <a class="teacher-link" href="#/teacher" ${navActive === "teacher" ? 'aria-current="page"' : ""}>${icon("lock",14)}교사 공간</a>
      </header>
      ${config.mode === "demo" ? `<div class="mode-banner"><span><i class="dot"></i><strong>체험 모드</strong> · 예시 응답이 들어 있어요. 이 기기에서만 저장돼요.</span><span lang="en">DEMO</span></div>` : ""}
      ${storageBlocked() ? '<p class="notice warning" style="margin-top:16px" role="status">이 브라우저가 임시 저장을 허용하지 않아요. 창을 닫으면 작성 중인 답변과 수정 권한이 사라질 수 있어요.</p>' : ""}
      <main class="page" id="main" tabindex="-1">${page}</main>
      <footer class="site-footer"><span>Binôme · 너와 나, 우리의 취향</span><span lang="fr">Un peu de français, beaucoup de découvertes.</span></footer>
    </div>`;
    if (sameView && activeId) document.getElementById(activeId)?.focus({preventScroll:true});
    if (sameView) for (const id of openedDetails) document.getElementById(id)?.setAttribute("open", "");
    renderedView = state.view;
  }

  function renderHome() {
    const rows = owned();
    return `<div class="home-layout">
      <section class="intro-panel" aria-label="짝 인터뷰">
        <h1 class="intro-title" tabindex="-1">나와 가장 잘 맞는 친구는</h1>
      </section>
      <section class="welcome-card card">
        <form class="home-form" data-form="start" id="start-form">
          ${errorBox()}
          <label class="field" for="class-code"><span class="field-label">우리 반 코드</span>
            <input id="class-code" name="code" class="code-input" value="${e(state.homeCode)}" placeholder="예: A1B2-C3D4-E5F6" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" required aria-describedby="code-help">
            <span class="field-help" id="code-help">선생님이 알려 준 코드를 입력해 주세요.</span>
          </label>
          <label class="field" for="partner-name"><span class="field-label name-label">짝의 이름<span class="name-ko">질문에 답해 줄 친구의 이름이에요.</span></span>
            <input id="partner-name" name="name" value="${e(state.homeName)}" placeholder="예: 민서" maxlength="48" autocomplete="off" required aria-describedby="name-help">
            <span class="field-help" id="name-help">이름이 같은 친구가 있다면 이름 뒤에 번호를 붙여 주세요.</span>
          </label>
          <button class="button gold full" type="submit" ${disabled()}>${state.busy ? "인터뷰를 준비하고 있어요…" : "짝과 인터뷰 시작하기"}${icon("arrow",19)}</button>
          <p class="form-note">${icon("info",15)}<span>내 이름이 아닌 <strong>짝의 이름</strong>을 적어요.<br>역할을 바꾼 뒤에는 다른 친구의 이름으로 한 번 더 진행해요.</span></p>
        </form>
        ${rows.length ? `<details class="owned-list"><summary>이 기기에서 기록한 응답 수정 / 이어 쓰기 <span class="muted">(${rows.length})</span></summary>
          ${rows.map(d=>`<div class="owned-row"><span>${e(d.name)} <small class="muted">· ${d.submitted_at ? d.dirty ? "수정 중" : "제출 완료" : "작성 중"}</small></span><button class="button small secondary" data-action="resume" data-id="${e(d.id)}" ${disabled()}>${d.submitted_at ? "수정" : "이어 쓰기"}</button></div>`).join("")}
        </details>` : ""}
      </section>
    </div>;
  }

  function renderProgress(d) {
    return `<ol class="progress-nav" aria-label="인터뷰 진행 상황">${QUESTIONS.map((q,i)=>`<li><button id="progress-${i}" class="progress-step ${Number.isInteger(d.answers[i]) ? "answered" : ""} ${state.step === i ? "current" : ""}" data-action="step" data-step="${i}" aria-label="${i+1}번 질문: ${q.short}${Number.isInteger(d.answers[i]) ? ", 선택 완료" : ""}" ${state.step===i ? 'aria-current="step"' : ""}><span class="number">${Number.isInteger(d.answers[i]) && state.step!==i ? icon("check",14) : i+1}</span><span class="label">${e(q.short)}</span></button></li>`).join("")}</ol>`;
  }
  function renderQuestion() {
    const d = draft(); if (!d) return renderHome();
    const n = state.step; const q = QUESTIONS[n]; const answer = d.answers[n];
    const filled = Number.isInteger(answer);
    const nextText = state.editingReview ? "확인 화면으로" : n===4 ? "답변 확인하기" : "다음 질문";
    return `<div class="interview-wrap">
      <div class="activity-header"><p class="activity-name"><strong>${e(d.name)}</strong>에 대해 알아볼까요?</p><span class="pill">${icon("users",13)}짝 인터뷰</span></div>
      ${renderProgress(d)}
      <section class="question-card card">${errorBox()}
        <div class="question-topline"><span class="question-number">QUESTION ${String(n+1).padStart(2,"0")} / 05</span><span class="pill" lang="fr">${e(q.verb)}</span></div>
        <h1 class="question-title" tabindex="-1" lang="fr">${e(q.title)}</h1><p class="question-ko">${e(q.ko)}</p>
        <div class="dialogue-box"><p class="dialogue-caption">${icon("chat",16)}질문하고 대답해봅시다!</p>
          <div class="dialogue-line"><span class="role-tag">질문</span><p lang="fr">${e(q.ask)}</p></div>
          <div class="dialogue-line"><span class="role-tag">대답</span><p lang="fr">${e(q.answer)} <span class="answer-phrase">${e(answerPhrase(q,answer))}</span>${q.suffix ? " "+e(q.suffix) : "."}</p></div>
        </div>
        <p class="choice-heading">짝이 선택한 답을 하나 골라 주세요.</p>
        <fieldset class="options ${q.options.length===2 ? "long" : ""}"><legend class="sr-only">${e(q.ko)} 한 가지 선택</legend>
          ${q.options.map((option,oi)=>`<label class="option ${answer===oi ? "selected" : ""}" for="option-${n}-${oi}"><input id="option-${n}-${oi}" type="radio" name="answer" value="${oi}" data-question="${n}" ${answer===oi ? "checked" : ""}><span class="option-letter">${LETTERS[oi]}</span><span class="option-copy"><span class="option-fr" lang="fr">${e(option.fr)}</span><span class="option-ko">${e(option.ko)}</span></span><span class="option-check">${icon("check",20)}</span></label>`).join("")}
        </fieldset>
        <div class="activity-actions"><button id="previous-question" class="button secondary" data-action="previous">${icon("back",17)}${state.editingReview ? "전체 답변" : n===0 ? "이름 화면" : "이전 질문"}</button><span class="activity-count">${d.answers.filter(Number.isInteger).length} / 5 선택</span><button id="next-question" class="button" data-action="next" ${!filled ? "disabled" : ""}>${nextText}${icon("arrow",17)}</button></div>
      </section>
      <p class="save-indicator">${icon("lock",12)}${config.mode === "demo" ? "제출 전까지 답변은 이 기기에 임시 저장돼요." : "‘제출하기’를 누르면 다섯 답변이 함께 저장돼요."}</p>
    </div>`;
  }

  function renderReview() {
    const d = draft(); if (!d) return renderHome();
    return `<div class="review-wrap"><div class="page-heading"><div><span class="eyebrow">PRESQUE FINI !</span><h1 tabindex="-1">짝의 답을 확인해요.</h1><p class="subcopy"><strong>${e(d.name)}</strong>의 취향을 잘 기록했나요?</p></div><span class="pill">${d.answers.filter(Number.isInteger).length} / 5 선택</span></div>
      <section class="review-card card">${errorBox()}<div>
        ${QUESTIONS.map((q,i)=>{ const a=q.options[d.answers[i]]; return `<div class="review-item"><span class="review-number">${String(i+1).padStart(2,"0")}</span><div class="review-copy"><p class="review-question" lang="fr">${e(q.title)}</p><p class="review-answer" lang="fr">${a ? `${LETTERS[d.answers[i]]}. ${e(a.fr)}` : "아직 선택하지 않았어요."}</p>${a ? `<p class="review-ko">${e(a.ko)}</p>` : ""}</div><button class="button small secondary" data-action="edit-question" data-step="${i}" aria-label="${i+1}번 답변 수정">수정</button></div>`; }).join("")}
      </div><p class="notice">${config.mode === "demo" ? "체험 모드에서는 이 기기에 저장돼요." : "제출하면 우리 반 대시보드에 반영돼요."} 제출한 뒤에도 이 기기에서 답변을 수정할 수 있어요.</p>
      <div class="button-row end"><button class="button secondary" data-action="review-back" ${disabled()}>${icon("back",17)}질문으로</button><button class="button gold" data-action="submit" ${!isComplete(d.answers) ? "disabled" : disabled()}>${state.busy ? "제출하고 있어요…" : d.submitted_at ? "수정 내용 제출하기" : "제출하기"}${icon("check",19)}</button></div></section>
    </div>`;
  }

  function renderDone() {
    const d=draft(); if (!d) return renderHome();
    return `<section class="success-card card"><div class="success-mark">${icon("check",40)}</div><span class="eyebrow" lang="fr">MERCI, C’EST NOTÉ !</span><h1 tabindex="-1">짝의 취향을 기록했어요.</h1><p class="subcopy">${config.mode === "demo" ? "이 기기의 체험 대시보드에 반영됐어요." : "우리 반 대시보드에 응답이 반영됐어요."}<br>이제 역할을 바꿔 서로 질문해 보세요.</p><div class="success-name">${icon("users",16)}${e(d.name)} · 5개 답변 제출 완료</div><div class="button-row"><button class="button" data-action="new-interview">역할 바꿔 인터뷰하기${icon("arrow",17)}</button><a class="button secondary" href="#/dashboard">우리 반 결과 보기${icon("chart",17)}</a></div><p class="text-small muted">대시보드에서는 <strong>자신의 이름</strong>을 선택해 친구를 찾아요.</p><button class="inline-link text-small" data-action="edit-submitted">방금 제출한 답변 수정</button></section>`;
  }

  function renderDashboardEntry() {
    return `<section class="dashboard-entry card"><span class="eyebrow">NOTRE CLASSE</span><h1 tabindex="-1">우리 반으로 들어가요.</h1><p class="subcopy" style="margin-bottom:24px">반 코드를 입력하면 친구들의 취향을 볼 수 있어요.</p><form data-form="dashboard-code">${errorBox()}<label class="field" for="dashboard-code"><span class="field-label">우리 반 코드</span><input class="code-input" id="dashboard-code" name="code" maxlength="16" value="${e(formatCode(client.code))}" placeholder="A1B2-C3D4-E5F6" autocomplete="off" required></label><button class="button full" type="submit" ${disabled()}>대시보드 열기${icon("arrow",17)}</button></form></section>`;
  }

  function renderMatch(responses) {
    const selected = client.selectedByRoom[client.code] || "";
    const result = findMatches(responses,selected);
    let content;
    if (!result.me) content = '<div class="match-empty">내 이름을 고르면<br>가장 비슷한 취향의 친구가 나타나요.</div>';
    else if (!result.matches.length) content = '<div class="match-empty">아직 비교할 친구의 응답이 없어요.<br>친구가 제출한 뒤 다시 확인해 주세요.</div>';
    else {
      const shown=state.showAllMatches ? result.matches : result.matches.slice(0,4);
      content=`<p class="match-score"><strong>${result.score}<small> / 5</small></strong><span>개의 답이 같아요 · 일치율 ${result.score*20}%</span></p><div class="match-list">${shown.map(r=>`<div class="friend-card"><div class="friend-name"><span class="avatar" aria-hidden="true">${e([...r.name][0])}</span>${e(r.name)}</div><div class="shared-list">${r.shared.length ? r.shared.map(qi=>`<span class="shared-tag">${qi+1}. ${e(QUESTIONS[qi].short)}</span>`).join("") : '<span class="shared-tag">같은 답이 아직 없어요</span>'}</div></div>`).join("")}</div><p class="match-help">${result.matches.length>1 ? `가장 많이 겹치는 친구가 ${result.matches.length}명이에요. 동점인 친구를 함께 보여드려요.` : "다섯 질문에서 같은 보기를 고른 개수로 연결했어요."}</p>${result.matches.length>4 ? `<button class="inline-link" data-action="show-matches">${state.showAllMatches ? "접기" : `동점인 친구 ${result.matches.length}명 모두 보기`}</button>` : ""}`;
    }
    return `<section class="match-card"><span class="eyebrow">MON DUO DE GOÛTS</span><h2>나와 취향이 닮은 친구</h2><div class="match-selection"><label for="my-name">인터뷰한 짝이 등록해 준 <strong>내 이름</strong>을 선택해요.</label><select id="my-name" ${!responses.length ? "disabled" : ""}><option value="">내 이름을 선택해 주세요</option>${[...responses].sort(sortNames).map(r=>`<option value="${e(r.id)}" ${r.id===selected ? "selected" : ""}>${e(r.name)}</option>`).join("")}</select></div><div class="match-content">${content}</div></section>`;
  }
  function renderCharts(responses) {
    const data = summarize(responses);
    const colors=["#84AFC2","#00000024","#00000024","#00000024"];
    return `<div class="charts-header"><div><span class="eyebrow">LES GOÛTS DE NOTRE CLASSE</span><h2>우리 반은 어떤 걸 좋아할까?</h2></div><p>각 질문 하나씩 선택 · 최종 제출 ${responses.length}명 기준</p></div><div class="charts-grid">${QUESTIONS.map((q,qi)=>`<section class="chart-card card" aria-labelledby="chart-${qi}"><div class="chart-title"><span class="chart-number">0${qi+1}</span><div><h3 id="chart-${qi}">${e(q.short)}</h3><p lang="fr">${e(q.title)}</p></div></div><div class="chart-rows">${q.options.map((o,oi)=>`<div class="chart-option"><div class="chart-label-line"><p class="chart-label" id="chart-label-${qi}-${oi}"><b>${LETTERS[oi]}.</b> ${e(o.ko)}<br><span lang="fr">${e(o.fr)}</span></p><span class="chart-value"><strong>${data[qi].counts[oi]}명</strong>${data[qi].percentages[oi]}%</span></div><progress class="chart-bar" value="${data[qi].counts[oi]}" max="${Math.max(1,responses.length)}" style="--bar-color:${colors[oi]}" aria-labelledby="chart-label-${qi}-${oi}" aria-valuetext="${data[qi].counts[oi]}명, ${data[qi].percentages[oi]}퍼센트">${data[qi].percentages[oi]}%</progress></div>`).join("")}</div><p class="chart-footer">${responses.length ? "비율은 반올림하여 합계가 100%와 다를 수 있어요." : "아직 제출한 응답이 없어요."}</p></section>`).join("")}</div>`;
  }
  function renderDashboard() {
    if (!client.code || state.switchingRoom) return renderDashboardEntry();
    const snapshot=state.snapshot;
    const room=snapshot?.room || state.room;
    const expired=Boolean(room && Date.parse(room.expires_at)<=Date.now());
    const responses=completedResponses(snapshot?.responses);
    const refreshed=state.lastFetch ? new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:"Asia/Seoul"}).format(state.lastFetch) : "아직 조회하지 않았어요";
    return `<div class="page-heading dashboard-head"><div><span class="eyebrow">NOTRE CLASSE, NOS GOÛTS</span><h1 tabindex="-1" lang="fr">Trouve ton duo.</h1><p class="subcopy">우리 반에서 나와 취향이 닮은 친구를 찾아요.</p></div><div class="dashboard-controls"><div class="refresh-controls"><label class="auto-refresh" for="auto-refresh"><input type="checkbox" id="auto-refresh" ${state.autoRefresh ? "checked" : ""}>${Math.round(config.pollIntervalMs/1000)}초마다 자동 조회</label><button class="button secondary small" id="refresh-button" data-action="refresh" ${state.refreshing ? 'disabled aria-busy="true"' : ""}>${icon("refresh",16,state.refreshing ? "spinning" : "")}${state.refreshing ? "불러오는 중" : "새로고침"}</button></div><p class="refresh-time">${state.lastFetch ? "마지막 조회 " : ""}${e(refreshed)}</p></div></div>
      <div class="room-meta-row"><span class="pill">${icon("users",13)}${e(room?.name || "우리 반")}</span>${room ? `<span class="pill ${!room.is_open || expired ? "closed" : ""}">${expired ? "기간 종료" : room.is_open ? "응답 받는 중" : "제출 마감"}</span>` : ""}<span class="room-code">${e(formatCode(client.code))}</span><button class="inline-link text-small" data-action="switch-room">반 코드 변경</button></div>
      ${errorBox()}${state.refreshError ? `<div class="form-error" role="alert">${icon("info",18)}<span>${e(state.refreshError)}${snapshot ? " 마지막으로 조회한 결과를 표시하고 있어요." : ""}</span></div>` : ""}
      ${state.teacherRoomId && api.isTeacher && room ? `<div class="teacher-toolbar"><span class="pill">${icon("lock",13)}교사 관리</span><a class="button secondary small" href="#/teacher">반 목록</a><button class="button secondary small" data-action="toggle-room" ${expired ? 'disabled title="참여 기간이 끝났어요. 새 반을 만들어 주세요."' : disabled()}>${room.is_open ? "제출 마감하기" : "응답 다시 열기"}</button><button class="button secondary small" data-action="csv" ${!responses.length ? "disabled" : ""}>${icon("download",14)}CSV 다운로드</button><button class="button ghost small" data-action="delete-room" ${disabled()}>${icon("trash",14)}반 삭제</button></div>` : ""}
      ${snapshot ? `<div class="dashboard-summary">${renderMatch(responses)}<div class="summary-side"><section class="count-card card"><div><span class="eyebrow">RÉPONSES COLLECTÉES</span><p class="text-small muted" style="margin-top:5px">최종 제출한 친구</p><p class="count-number">${responses.length}<span>명</span></p></div><span class="count-icon">${icon("users",28)}</span></section><aside class="class-note"><span class="eyebrow" lang="fr">PAREILS, OU DIFFÉRENTS ?</span><h3>같은 취향은 반갑고,<br>다른 취향은 새로워요.</h3><p>다섯 가지 선택으로 찾는 오늘의 취향 친구.<br>서로의 이유도 프랑스어로 이야기해 보세요.</p></aside></div></div>
      ${snapshot && !responses.length ? `<section class="dashboard-empty card"><h2>첫 번째 인터뷰를 기다리고 있어요.</h2><p>친구들이 다섯 질문에 답하고 제출하면 그래프와 친구 찾기에 반영돼요.</p><a class="button secondary" href="#/">짝 인터뷰 시작하기${icon("arrow",17)}</a></section>` : ""}
      ${renderCharts(responses)}
      ${state.teacherRoomId && api.isTeacher && snapshot ? `<details class="admin-responses card" id="admin-responses"><summary>학생 응답 관리 · 제출 ${responses.length}명 / 작성 중 ${snapshot.drafts?.length||0}명</summary><p class="field-help">잘못 등록된 이름이나 작성 중인 응답을 삭제한 뒤 다시 입력할 수 있어요.</p>${[...responses,...(snapshot.drafts||[])].sort(sortNames).map(r=>`<div class="admin-response-row"><span>${e(r.name)}</span><span class="pill ${r.submitted_at ? "" : "yellow"}">${r.submitted_at ? "제출 완료" : "작성 중"}</span><button class="button small ghost" data-action="delete-response" data-id="${e(r.id)}" aria-label="${e(r.name)} 응답 삭제" ${disabled()}>${icon("trash",16)}삭제</button></div>`).join("") || '<p class="empty-copy">아직 등록된 학생이 없어요.</p>'}</details>` : ""}` : `<section class="dashboard-empty card"><h2>${state.refreshError ? "결과를 불러오지 못했어요." : "우리 반 응답을 확인할게요."}</h2><p role="status">${state.refreshing ? "최신 응답을 불러오고 있어요…" : "위의 새로고침 버튼으로 다시 조회할 수 있어요."}</p></section>`}`;
  }

  function expiresLabel(room) {
    return new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Seoul"}).format(new Date(room.expires_at));
  }
  function renderTeacher() {
    if (!api.isTeacher) return `<section class="teacher-login card"><span class="eyebrow">ESPACE ENSEIGNANT</span><h1 tabindex="-1">교사 공간</h1><p class="subcopy">반을 만들고, 응답을 관리해요.</p>${config.mode==="demo" ? `<div class="notice" style="margin:22px 0">체험 모드에서는 로그인 없이 반 관리 기능을 둘러볼 수 있어요.</div>${errorBox()}<button class="button full" data-action="demo-login" ${disabled()}>체험 반 관리하기${icon("arrow",17)}</button>` : `<form data-form="login">${errorBox()}<label class="field" for="teacher-email"><span class="field-label">교사 이메일</span><input type="email" id="teacher-email" name="email" value="${e(state.teacherEmail)}" autocomplete="username" required></label><label class="field" for="teacher-password"><span class="field-label">비밀번호</span><input type="password" id="teacher-password" name="password" autocomplete="current-password" required></label><button class="button full" type="submit" ${disabled()}>${state.busy ? "로그인하고 있어요…" : "로그인"}${icon("lock",17)}</button><p class="field-help" style="margin-top:16px">등록된 교사 계정으로 로그인해 주세요.</p></form>`}</section>`;
    return `<div class="page-heading"><div><span class="eyebrow">ESPACE ENSEIGNANT</span><h1 tabindex="-1">오늘의 수업을 준비해요.</h1><p class="subcopy">반별로 코드를 나누면 응답이 섞이지 않아요.</p></div><button class="button secondary small" data-action="logout" ${disabled()}>로그아웃</button></div>${errorBox()}<div class="teacher-layout"><section class="create-room-card card"><span class="eyebrow">NOUVELLE CLASSE</span><h2>새 활동 만들기</h2><form data-form="create-room"><label class="field" for="room-name"><span class="field-label">반 / 활동 이름</span><input id="room-name" name="name" maxlength="60" placeholder="예: 1학년 3반 · 프랑스어" value="${e(state.createName)}" required></label><label class="field" for="room-days"><span class="field-label">참여 기간</span><select id="room-days" name="days">${[[1,"1일"],[7,"7일"],[30,"30일"]].map(([value,label])=>`<option value="${value}" ${String(value)===state.createDays ? "selected" : ""}>${label}</option>`).join("")}</select><span class="field-help">기간이 끝나면 학생의 조회와 제출이 종료돼요. 교사는 계속 확인할 수 있어요.</span></label><button class="button gold full" type="submit" ${disabled()}>${state.busy ? "만드는 중…" : "반 코드 만들기"}${icon("plus",17)}</button></form></section><section aria-label="내 반 목록" class="room-list">${state.teacherLoading && !state.teacherRooms ? '<div class="notice" role="status">반 목록을 불러오고 있어요…</div>' : (state.teacherRooms||[]).map(room=>{const expired=Date.parse(room.expires_at)<=Date.now();return `<article class="room-card card"><div class="room-card-top"><h2>${e(room.name)}</h2><span class="pill ${!room.is_open||expired ? "closed" : ""}">${expired ? "기간 종료" : room.is_open ? "응답 받는 중" : "제출 마감"}</span></div><p class="class-code-display">${e(formatCode(room.code))}</p><div class="room-details"><span>제출 <strong>${room.total}</strong>명</span><span>작성 중 ${room.draft_count}명</span><span>${e(expiresLabel(room))}까지</span></div><div class="button-row"><button class="button small" data-action="teacher-dashboard" data-id="${e(room.id)}" data-code="${e(room.code)}" ${disabled()}>대시보드${icon("arrow",15)}</button><button class="button small secondary" data-action="copy-code" data-code="${e(room.code)}">${icon("copy",14)}코드 복사</button><button class="button small secondary" data-action="copy-link" data-code="${e(room.code)}">참여 링크 복사</button></div></article>`;}).join("") || '<div class="teacher-empty card"><span class="step-icon" style="margin:auto">'+icon("users",24)+'</span><span class="eyebrow">ON COMMENCE ?</span><h2>첫 반을 만들어 보세요.</h2><p>반 코드를 학생들에게 알려 주면<br>바로 인터뷰를 시작할 수 있어요.</p></div>'}</section></div>`;
  }

  async function startInterview(form) {
    const data=new FormData(form); const code=cleanCode(data.get("code")); const name=cleanName(data.get("name"));
    state.homeName=name;
    const invalid=validateName(name);
    if(invalid) { state.error=invalid; render(); focusError(); return; }
    if(code.length!==12) { state.error="12자리 반 코드를 입력해 주세요. 하이픈은 생략해도 돼요."; render(); focusError(); return; }
    setCode(code); state.teacherRoomId=null;
    await perform(async()=>{
      state.room=await api.room(code);
      const existing=Object.values(client.drafts).find(d=>d?.code===code && cleanName(d.name).toLowerCase()===name.toLowerCase());
      const d=existing || {id:safeUuid(),token:safeUuid(),name,code,answers:Array(5).fill(null),version:0,reserved:false};
      d.name=name; saveDraft(d);
      const saved=await api.reserve(code,d);
      if(!d.dirty || d.version!==saved.version) d.answers=saved.answers || (d.submitted_at ? Array(5).fill(null) : d.answers);
      Object.assign(d,{name:saved.name,version:saved.version,submitted_at:saved.submitted_at,reserved:true});
      if(!Array.isArray(d.answers)||d.answers.length!==5) d.answers=Array(5).fill(null);
      saveDraft(d); state.editingReview=false;
      navigate("interview",0);
    });
  }
  async function resume(id) {
    const d=client.drafts[id]; if(!d) return;
    await perform(async()=>{
      setCode(d.code); state.teacherRoomId=null;
      state.room=await api.room(d.code);
      const saved=await api.reserve(d.code,d);
      if(!d.dirty || saved.version!==d.version) d.answers=saved.answers || d.answers;
      Object.assign(d,{name:saved.name,version:saved.version,submitted_at:saved.submitted_at,reserved:true});
      saveDraft(d); state.editingReview=false;
      navigate(isComplete(d.answers)?"review":"interview",Math.max(0,d.answers.findIndex(a=>!Number.isInteger(a))));
    });
  }

  function refreshControls() {
    const button=document.getElementById("refresh-button");
    if(button){ button.disabled=state.refreshing; button.setAttribute("aria-busy",String(state.refreshing));
      button.innerHTML=icon("refresh",16,state.refreshing?"spinning":"")+(state.refreshing?"불러오는 중":"새로고침"); }
  }
  async function refreshSnapshot(manual=true) {
    if(refreshPromise) return refreshPromise;
    if(!client.code || state.view!=="dashboard" || state.switchingRoom) return;
    const code=client.code, teacherId=state.teacherRoomId, generation=dashboardGeneration;
    state.refreshing=true;
    if(!state.snapshot) render(); else refreshControls();
    const current=()=>state.view==="dashboard" && client.code===code && state.teacherRoomId===teacherId && dashboardGeneration===generation;
    refreshPromise=(async()=>{
      try {
        const result=teacherId && api.isTeacher ? await api.teacherDashboard(teacherId) : await api.dashboard(code);
        if(!current()) return;
        if(!result || !result.room || !Array.isArray(result.responses)) throw new Error("서버가 올바른 대시보드 데이터를 반환하지 않았어요.");
        state.snapshot=result; state.room=result.room; state.lastFetch=new Date(); state.refreshError="";
        if(client.selectedByRoom[code] && !result.responses.some(r=>r.id===client.selectedByRoom[code])) {
          client.selectedByRoom[code]=""; persist();
        }
        if(manual) announce(`우리 반 최종 응답 ${completedResponses(result.responses).length}명을 조회했어요.`);
      } catch(error) {
        if(current()) { state.refreshError=friendlyError(error); if(manual) announce(state.refreshError); }
      } finally {
        state.refreshing=false; refreshPromise=null;
        if(state.view==="dashboard") render();
        if(state.view==="dashboard" && !state.switchingRoom && !current()) queueMicrotask(()=>void refreshSnapshot(false));
      }
    })();
    return refreshPromise;
  }
  async function loadTeacher() {
    if(state.teacherLoading || !api.isTeacher) return;
    state.teacherLoading=true;
    if(state.view==="teacher") render();
    try { state.teacherRooms=await api.teacherRooms(); }
    catch(error) { state.error=friendlyError(error); }
    finally { state.teacherLoading=false; if(state.view==="teacher") render(); }
  }
  async function copy(value) {
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const field=document.createElement("textarea"); field.value=value; field.style.cssText="position:fixed;left:-9999px;top:0";
        document.body.append(field); field.select(); const ok=document.execCommand("copy"); field.remove();
        if(!ok) throw new Error("copy failed");
      }
      toast("복사했어요.");
    } catch { toast("복사하지 못했어요. 표시된 반 코드를 직접 적어 주세요."); }
  }
  function confirmDelete(title,description) {
    const dialog=document.getElementById("confirm-dialog");
    document.getElementById("dialog-title").textContent=title;
    document.getElementById("dialog-description").textContent=description;
    if(!dialog.showModal) return Promise.resolve(window.confirm(title+"\n\n"+description));
    return new Promise(resolve=>{
      dialog.returnValue="cancel"; dialog.addEventListener("close",()=>resolve(dialog.returnValue==="confirm"),{once:true});
      dialog.showModal();
    });
  }

  app.addEventListener("submit",event=>{
    const form=event.target.closest("form[data-form]"); if(!form) return;
    event.preventDefault(); if(state.busy) return;
    const data=new FormData(form);
    if(form.dataset.form==="start") void startInterview(form);
    if(form.dataset.form==="dashboard-code") {
      const code=cleanCode(data.get("code"));
      if(code.length!==12){state.error="12자리 반 코드를 입력해 주세요.";render();focusError();return;}
      void perform(async()=>{
        const room=await api.room(code); setCode(code); state.room=room;
        state.teacherRoomId=null; state.switchingRoom=false; dashboardGeneration++;
        await refreshSnapshot(true);
      });
    }
    if(form.dataset.form==="login") {
      state.teacherEmail=String(data.get("email"));
      const password=String(data.get("password"));
      void perform(async()=>{await api.login(state.teacherEmail,password); await loadTeacher();});
    }
    if(form.dataset.form==="create-room") {
      state.createName=String(data.get("name")).trim(); state.createDays=String(data.get("days"));
      void perform(async()=>{
        const room=await api.createRoom(state.createName,Number(state.createDays));
        state.createName=""; await loadTeacher(); toast(`${room.name}의 반 코드를 만들었어요.`);
      });
    }
  });

  app.addEventListener("change",event=>{
    lastInteractionAt=Date.now();
    const target=event.target;
    if(target.matches('input[name="answer"]')) {
      const d=draft(); if(!d) return;
      d.answers[Number(target.dataset.question)]=Number(target.value); d.dirty=true; saveDraft(d); render();
      announce(`${LETTERS[Number(target.value)]} 보기를 선택했어요.`);
    }
    if(target.id==="my-name") {
      client.selectedByRoom[client.code]=target.value; state.showAllMatches=false; persist(); render();
      const result=findMatches(state.snapshot?.responses,target.value);
      announce(result.me ? result.matches.length ? `가장 비슷한 친구 ${result.matches.map(r=>r.name).join(", ")}. 다섯 답 중 ${result.score}개가 같아요.` : "아직 비교할 친구가 없어요." : "내 이름을 선택해 주세요.");
    }
    if(target.id==="auto-refresh") state.autoRefresh=target.checked;
  });
  app.addEventListener("input",event=>{
    lastInteractionAt=Date.now();
    if(event.target.id==="partner-name") state.homeName=event.target.value;
    if(event.target.id==="class-code") state.homeCode=event.target.value;
    if(event.target.id==="room-name") state.createName=event.target.value;
    if(event.target.id==="teacher-email") state.teacherEmail=event.target.value;
  });
  app.addEventListener("click",event=>{
    lastInteractionAt=Date.now();
    const button=event.target.closest("[data-action]"); if(!button || button.disabled || state.busy) return;
    const action=button.dataset.action;
    const d=draft();
    if(action==="step") navigate("interview",Number(button.dataset.step));
    if(action==="previous") {
      if(state.editingReview) navigate("review"); else if(state.step===0) navigate("home"); else navigate("interview",state.step-1);
    }
    if(action==="next" && d && Number.isInteger(d.answers[state.step])) {
      if(state.editingReview || state.step===4) {state.editingReview=false;navigate("review");}
      else navigate("interview",state.step+1);
    }
    if(action==="edit-question") {state.editingReview=true;navigate("interview",Number(button.dataset.step));}
    if(action==="review-back") {state.editingReview=false;navigate("interview",4);}
    if(action==="submit" && d && isComplete(d.answers)) void perform(async()=>{
      const saved=await api.submit(d.code,d);
      Object.assign(d,{answers:saved.answers,version:saved.version,submitted_at:saved.submitted_at,dirty:false});
      saveDraft(d); state.snapshot=null; state.teacherRoomId=null; navigate("done");
    });
    if(action==="new-interview") {client.activeId="";persist();state.homeName="";state.editingReview=false;navigate("home");}
    if(action==="edit-submitted") {state.editingReview=false;navigate("review");}
    if(action==="resume") void resume(button.dataset.id);
    if(action==="refresh") void refreshSnapshot(true);
    if(action==="switch-room") {dashboardGeneration++;state.switchingRoom=true;state.error="";render();}
    if(action==="show-matches") {state.showAllMatches=!state.showAllMatches;render();}
    if(action==="demo-login") void perform(async()=>{await api.login();await loadTeacher();});
    if(action==="logout") void perform(async()=>{
      await api.logout(); state.teacherRoomId=null; state.teacherRooms=null;
      state.snapshot=null; state.error=""; dashboardGeneration++;
    });
    if(action==="teacher-dashboard") {
      setCode(button.dataset.code); state.teacherRoomId=button.dataset.id;
      state.snapshot=null; state.switchingRoom=false; dashboardGeneration++; navigate("dashboard");
    }
    if(action==="copy-code") void copy(formatCode(button.dataset.code));
    if(action==="copy-link") {
      const url=new URL(location.href); url.search="";url.searchParams.set("classe",cleanCode(button.dataset.code));url.hash="/";void copy(url.toString());
    }
    if(action==="toggle-room" && state.snapshot) void perform(async()=>{
      await api.setOpen(state.teacherRoomId,!state.snapshot.room.is_open); await refreshSnapshot(true);
    });
    if(action==="csv" && state.snapshot) {
      const blob=new Blob([toCsv(state.snapshot.responses)],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;link.download=`Binome-${client.code}.csv`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if(action==="delete-response") {
      const row=[...(state.snapshot?.responses||[]),...(state.snapshot?.drafts||[])].find(r=>r.id===button.dataset.id);
      if(row) void (async()=>{
        if(!await confirmDelete(`${row.name}의 응답을 삭제할까요?`,"이름과 답변을 지웁니다. 삭제한 응답은 복구할 수 없어요.")) return;
        await perform(async()=>{await api.deleteResponse(state.teacherRoomId,row.id);delete client.drafts[row.id];persist();await refreshSnapshot(true);toast("응답을 삭제했어요.");});
      })();
    }
    if(action==="delete-room" && state.snapshot) void (async()=>{
      const room=state.snapshot.room;
      if(!await confirmDelete(`${room.name}을 삭제할까요?`,"반 코드와 이 반의 모든 이름·답변을 함께 지웁니다. 삭제한 반은 복구할 수 없어요.")) return;
      await perform(async()=>{
        await api.deleteRoom(room.id);state.teacherRoomId=null;state.snapshot=null;state.teacherRooms=null;
        setCode("");await loadTeacher();navigate("teacher");toast("반과 응답을 삭제했어요.");
      });
    })();
  });

  document.querySelector(".skip-link")?.addEventListener("click",event=>{
    event.preventDefault();const main=document.getElementById("main");main?.focus();main?.scrollIntoView?.({block:"start"});
  });
  app.addEventListener("pointerdown",()=>{lastInteractionAt=Date.now();});
  app.addEventListener("keydown",()=>{lastInteractionAt=Date.now();});
  setInterval(()=>{
    const recentlyInteracting=Date.now()-lastInteractionAt<2000;
    if(state.view==="dashboard" && state.autoRefresh && !document.hidden && !state.busy && !recentlyInteracting) void refreshSnapshot(false);
  },config.pollIntervalMs);
  window.addEventListener("hashchange",route);
  window.addEventListener("online",()=>{if(state.view==="dashboard") void refreshSnapshot(false);});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden && state.view==="dashboard" && state.autoRefresh) void refreshSnapshot(false);});
  window.addEventListener("storage",event=>{
    if(config.mode==="demo" && event.key==="binome:v1:demo-database" && state.view==="dashboard") void refreshSnapshot(false);
  });
  persist(); route();
}
