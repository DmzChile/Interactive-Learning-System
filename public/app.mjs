import { APP_VERSION, AI_TIMEOUT_MS, AI_CLIENT_TIMEOUT_MS, CONCEPTS, LEVELS, STAGES, LIMITS, current, taskOf, versionOf, questionsOf, evaluationOf, isBusy, emptyState, reduce, beginRequest, failRequest, makeContext, applyResponse, serialize, restore, validate, assert } from './domain.mjs';

let state = emptyState(), view = 'workspace', dirty = false, consent = false;
let connection = { configured: false, reachable: false, verified: false, model: 'gpt-5-mini' };
let toastTimer;
let requestError = null;
const requestStages = { local_validation: '요청 전 확인', local_request: '브라우저 → 로컬 서버', local_response: '로컬 서버 응답', validated: '서버에서 답변 확인 완료', upstream_request: '서버 → OpenAI 요청 시작, 응답 헤더 미수신', upstream_headers: 'OpenAI 응답 헤더 수신', upstream_body: 'OpenAI 응답 본문 수신', apply: '화면에 결과 반영' };
const launchToken = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
const app = document.querySelector('#app');
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
function notify(message, error = false) {
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.className = `toast${error ? ' error' : ''}`; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 9000 : 5000);
}
function safe(action) { return (...args) => { try { const result = action(...args); if (result?.catch) result.catch(error => notify(error.message || '작업을 처리하지 못했습니다.', true)); } catch (error) { notify(error.message || '작업을 처리하지 못했습니다.', true); } }; }
const button = (text, action, kind = '', disabled = false, attrs = {}) => h('button', { type: 'button', class: `button ${kind}`, disabled, onclick: safe(action), ...attrs }, text);
const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
const small = text => h('p', { class: 'muted small' }, text);
const stamp = text => h('p', { class: 'eyebrow' }, text);
const time = date => new Date(date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const versionName = (s, id) => `v${s.versions.findIndex(v => v.id === id) + 1}`;
function commit(event, redraw = true) { state = reduce(state, event); dirty = true; if (redraw) render(); else updateSaveStatus(); }
function updateSaveStatus() { const el = document.querySelector('#save-status'); if (el) el.textContent = dirty ? '저장하지 않은 변경' : '변경 없음'; }
function switchView(next) { view = next; render(); document.querySelector('#main')?.focus(); }
function field(label, control, note) { return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, note ? small(note) : null); }
function select(name, values, value) { return h('select', { name }, values.map(v => h('option', { value: v, selected: v === value }, v))); }
function panel(title, content, attrs = {}) { return h('section', { class: 'panel', ...attrs }, title ? h('div', { class: 'panel-heading' }, h('h2', {}, title)) : null, content); }
function guardReplace() { assert(!isBusy(current(state)), '요청이 진행 중입니다. 완료 후 파일을 불러오세요.'); return !dirty || window.confirm('저장하지 않은 변경이 있습니다. JSON으로 저장하지 않고 현재 학습을 바꿀까요?'); }
function exportJson() {
  const data = serialize(state), blob = new Blob([data], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `c-learning-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000); dirty = false; updateSaveStatus(); notify('JSON 다운로드를 시작했습니다. 저장한 파일로 학습을 복원할 수 있습니다.');
}
async function importJson(file) {
  if (!file) return;
  assert(file.size <= LIMITS.file, '2 MB 이하의 JSON 파일을 선택하세요.');
  const next = restore(await file.text());
  if (!guardReplace()) return;
  state = next; dirty = false; consent = false; view = 'workspace'; render();
  const interrupted = state.sessions.some(s => s.requests.some(r => r.status === 'interrupted'));
  notify(interrupted ? '학습을 복원했습니다. 중단된 요청은 자동 재전송하지 않습니다.' : '코드·질문·평가와 학습 상태를 복원했습니다.');
}
async function ask(action) {
  const s = current(state);
  let started, phase = 'local_validation';
  requestError = null;
  try {
    assert(connection.reachable, '서버가 연결되지 않았습니다. 터미널의 접속 주소 전체로 다시 열어 주세요.');
    if (s.source === 'live') { assert(connection.configured, '서버 시작 시 API 키를 입력해야 합니다.'); assert(consent, 'OpenAI API 전송 안내를 읽고 동의해 주세요.'); }
    started = beginRequest(state, action); state = started.state; dirty = true;
    const body = JSON.stringify({ requestId: started.requestId, action, context: makeContext(state), consent });
    render(); phase = 'local_request';
    const response = await fetch('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${launchToken}` }, body, signal: AbortSignal.timeout(AI_CLIENT_TIMEOUT_MS) });
    phase = 'local_response';
    let payload;
    try { payload = await response.json(); }
    catch (error) {
      if (error.name === 'TimeoutError') throw error;
      throw Object.assign(new Error('서버 응답이 올바른 JSON이 아닙니다. 실행 중인 서버와 접속 주소를 확인하세요.'), { code: 'LOCAL_RESPONSE', status: response.status });
    }
    if (!response.ok) throw Object.assign(new Error(payload.message || 'AI 요청을 처리하지 못했습니다.'), { code: payload.code, status: response.status, stage: payload.stage });
    phase = 'apply';
    assert(payload.requestId === started.requestId && payload.source === current(state).source, '응답의 요청 또는 모드가 일치하지 않습니다.');
    state = applyResponse(state, started.requestId, payload.data); state.settings.model = connection.model;
    if (s.source === 'live') connection.verified = true;
    dirty = true;
    if (action === 'evaluate') notify('제출본과 답변을 바탕으로 평가가 도착했습니다.');
  } catch (error) {
    if (started) state = failRequest(state, started.requestId);
    const message = error.name === 'TimeoutError' ? '브라우저에서 응답 대기를 중단했습니다. 코드와 답변은 유지됩니다.' : error.message;
    requestError = { message, stage: error.stage ?? phase, code: error.code ?? (error.name === 'TimeoutError' ? 'CLIENT_TIMEOUT' : phase === 'local_request' ? 'LOCAL_NETWORK' : 'CLIENT_ERROR'), status: error.status, requestId: started?.requestId };
    notify(message, true);
  } finally { render(); }
}
function beginSession(source) { consent = false; commit({ type: 'start', source }); view = 'workspace'; render(); }
function closeSession() {
  const s = current(state);
  if (!window.confirm('세션을 종료하고 결과를 정리할까요? 관찰이 부족한 개념은 기존 수준을 유지합니다.')) return;
  commit({ type: 'close' }); view = 'results'; render(); notify(s.source === 'demo' ? '모의 세션을 마쳤습니다. 실제 숙련도는 변경하지 않았습니다.' : '세션 결과를 정리했습니다. JSON으로 저장해 주세요.');
}
function privacyControl() {
  const s = current(state);
  if (s?.source === 'demo') return h('div', { class: 'notice demo' }, h('strong', {}, '모의 학습'), h('span', {}, '고정 예시로 흐름을 체험합니다. 외부 전송과 실제 평가·숙련도 변경은 없습니다.'));
  return h('label', { class: 'notice consent' }, h('input', { type: 'checkbox', checked: consent, disabled: isBusy(s), onchange: event => { consent = event.target.checked; } }), h('span', {}, h('strong', {}, 'AI 학습에 필요한 정보 전송'), h('span', {}, '코드·답변·목표·학습 경험·추정 수준을 OpenAI API로 보냅니다. 선택 입력한 학력은 보내지 않습니다. API 사용료가 발생할 수 있습니다. 동의합니다.')));
}
function connectionBadge() {
  return badge(!connection.reachable ? '로컬 연결 필요' : connection.verified ? 'AI 연결됨' : connection.configured ? '키 설정됨 · 연결 미확인' : 'API 키 없음', connection.verified ? 'green' : 'neutral');
}
function render() {
  const s = current(state), busy = isBusy(s);
  const upload = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: safe(event => importJson(event.target.files[0])) });
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '#', onclick: event => { event.preventDefault(); switchView('workspace'); } }, h('span', { class: 'brand-mark' }, 'C'), h('span', {}, h('strong', {}, 'C / LAB'), h('span', { class: 'brand-sub' }, 'C17 WORKSPACE'))),
    h('div', { class: 'side-content' }, stamp('나의 학습 공간'), h('nav', { 'aria-label': '주 메뉴' },
      ...[['workspace', '01', '학습 공간'], ['profile', '02', '학습 프로필'], ['results', '03', '평가 결과'], ['history', '04', '세션 기록']].map(([id, number, text]) => button([h('span', { class: 'nav-number' }, number), text], () => switchView(id), `nav-item ${view === id ? 'active' : ''}`, !state.profile && id !== 'workspace', { 'aria-current': view === id ? 'page' : null }))),
      s ? h('div', { class: 'session-meta' }, stamp('현재 세션'), h('p', { class: 'side-goal' }, s.goal || '목표를 정해 주세요'), badge(s.source === 'demo' ? '모의 학습' : '실제 AI 학습'), small(STAGES[s.stage])) : null,
      h('div', { class: 'side-footer' }, h('p', {}, '코드를 쓰고,', h('br'), '생각을 설명하세요.'), small('C17 · 실행 없는 코드 리뷰'), h('span', { class: 'version-label' }, `LOCAL / ${APP_VERSION}`))),
    h('div', { class: 'sidebar-mobile' }, badge('C17')));
  const header = h('header', { class: 'topbar' }, h('div', { class: 'crumb' }, '개인 학습', h('span', {}, '/'), h('strong', {}, view === 'profile' ? '프로필' : view === 'results' ? '평가 결과' : view === 'history' ? '세션 기록' : '학습 공간')), h('div', { class: 'top-actions' }, h('span', { id: 'save-status', class: 'save-status' }), button('불러오기', () => upload.click(), 'quiet', busy), button('JSON 저장', exportJson, 'outline'), upload));
  const main = h('main', { id: 'main', tabindex: '-1', class: 'main' });
  if (!state.profile) main.append(onboarding());
  else if (view === 'profile') main.append(profileView());
  else if (view === 'results') main.append(resultView());
  else if (view === 'history') main.append(historyView());
  else main.append(workspace());
  if (requestError) main.prepend(h('div', { class: 'notice error-notice', role: 'alert' },
    h('strong', {}, 'AI 요청을 완료하지 못했습니다'), h('span', {}, requestError.message),
    small(`확인 단계: ${requestStages[requestError.stage] ?? requestError.stage} · ${requestError.code}${requestError.status ? ` · HTTP ${requestError.status}` : ''}`),
    requestError.requestId ? small(`요청 ID: ${requestError.requestId}`) : null,
    button('닫기', () => { requestError = null; render(); }, 'quiet')));
  if (!connection.reachable) main.prepend(h('div', { class: 'notice error-notice' }, h('strong', {}, '로컬 서버 연결을 확인해 주세요.'), h('span', {}, '터미널에 표시된 접속 주소 전체를 다시 열면 모의 학습과 AI 요청을 사용할 수 있습니다. 열린 데이터의 열람·편집·저장은 가능합니다.')));
  app.replaceChildren(h('div', { class: 'shell' }, sidebar, h('div', { class: 'page' }, header, main)));
  updateSaveStatus();
}
function profileForm(existing = false) {
  const facts = state.profile?.facts ?? { education: '', experience: '', purpose: '', selfRating: '처음 시작', explanationStyle: '작은 예시부터', minutes: 20 };
  const form = h('form', { class: 'profile-form', onsubmit: safe(event => {
    event.preventDefault(); const values = new FormData(form);
    const facts = Object.fromEntries(values.entries()); facts.minutes = Number(facts.minutes);
    commit({ type: 'profile', facts }); view = 'workspace'; render(); notify(existing ? '사용자 정보를 수정했습니다. 추정 수준은 유지됩니다.' : '프로필을 만들었습니다. 학습 방식을 선택해 주세요.');
  }) },
    field('무엇을 위해 C를 배우나요?', h('textarea', { name: 'purpose', rows: 2, maxlength: 700, required: true, placeholder: '예: 메모리와 포인터를 이해하고 시스템 프로그래밍을 하고 싶어요.', value: facts.purpose })),
    h('div', { class: 'form-grid' }, field('현재 코딩 경험', select('selfRating', ['처음 시작', '기초 문법 학습', '작은 프로그램 작성', '프로젝트 경험'], facts.selfRating)), field('한 세션에 쓸 시간', h('select', { name: 'minutes' }, [10, 15, 20, 30, 45, 60, 90, 120, ...(![10, 15, 20, 30, 45, 60, 90, 120].includes(facts.minutes) ? [facts.minutes] : [])].map(n => h('option', { value: n, selected: n === facts.minutes }, `${n}분`))))),
    field('배워 보거나 만들어 본 것', h('textarea', { name: 'experience', rows: 2, maxlength: 700, placeholder: '다른 언어 경험도 좋아요. 없다면 비워 두세요.', value: facts.experience })),
    h('div', { class: 'form-grid' }, field('선호하는 설명 방식', select('explanationStyle', ['작은 예시부터', '원리와 수식 중심', '질문하며 단계별로'], facts.explanationStyle)), field('학습 배경 · 선택', h('input', { name: 'education', maxlength: 120, placeholder: '예: 대학 1학년 / 독학', value: facts.education }), '학교명이나 실명은 필요하지 않습니다.')),
    h('div', { class: 'form-footer' }, small('자기평가는 출발점입니다. 실제 수준은 코드와 설명을 통해 확인합니다.'), h('button', { type: 'submit', class: 'button primary', disabled: isBusy(current(state)) }, existing ? '프로필 수정' : '프로필 만들기')));
  return form;
}
function onboarding() {
  return h('div', { class: 'onboarding' }, h('div', { class: 'section-title' }, stamp('시작하기 / 01'), h('h1', {}, '어디서부터 시작할까요?'), h('p', { class: 'lead' }, '지금의 경험과 목표에 맞는 작은 과제부터 함께 풀어갑니다.')),
    h('div', { class: 'onboarding-grid' }, panel('나의 학습 프로필', h('div', { class: 'panel-body' }, profileForm())), h('aside', { class: 'intro-rail' }, h('div', { class: 'large-bracket' }, '{ C }'), h('h2', {}, '작성한 코드 너머의', h('br'), '생각까지 이해하기'), h('ol', { class: 'intro-steps' }, h('li', {}, '배우고 싶은 목표 정하기'), h('li', {}, '코드를 작성하고 설명하기'), h('li', {}, '근거를 보며 수정하기')), h('div', { class: 'intro-bottom' }, connectionBadge(), small('코드를 실행하거나 테스트 통과 여부를 판정하지 않습니다.')))));
}
function startChoices() {
  return h('div', { class: 'start-choices' }, h('div', { class: 'section-title' }, stamp('새 세션'), h('h1', {}, '다음 한 걸음을 정해 볼까요?'), h('p', { class: 'lead' }, state.profile.estimates.recommended)),
    h('div', { class: 'choice-grid' }, h('section', { class: 'choice-card' }, badge('AI TUTOR', 'blue'), h('h2', {}, '내 목표로 학습하기'), h('p', {}, 'AI가 과제를 구체화하고, 코드와 설명을 바탕으로 피드백합니다.'), connectionBadge(), button('AI 학습 시작', () => beginSession('live'), 'primary', !connection.configured || !connection.reachable), !connection.configured ? small('터미널에서 node server.mjs를 실행하고 API 키를 입력하세요.') : small(`선택 모델 · ${connection.model}`)), h('section', { class: 'choice-card' }, badge('GUIDED DEMO'), h('h2', {}, '학습 흐름 먼저 체험하기'), h('p', {}, '미리 준비된 과제·질문으로 제출, 설명, 저장과 복원을 체험합니다.'), small('실제 AI 평가와 숙련도 변경은 이루어지지 않습니다.'), button('모의 학습 시작', () => beginSession('demo'), 'outline', !connection.reachable))));
}
function workspace() {
  const s = current(state);
  if (!s) return startChoices();
  if (s.stage === 'closed') return h('div', {}, resultView(), h('div', { class: 'next-session' }, startChoices()));
  const t = taskOf(s), v = versionOf(s), busy = isBusy(s);
  const heading = h('div', { class: 'section-title workspace-title' }, h('div', {}, stamp(`${s.source === 'demo' ? '모의' : 'C17'} 학습 / SESSION ${String(state.sessions.indexOf(s) + 1).padStart(2, '0')}`), h('h1', {}, t?.data.title ?? '오늘의 학습 목표'), h('p', { class: 'lead' }, s.goal || '어떤 개념을 이해하거나, 어떤 프로그램을 만들고 싶나요?')), button('세션 종료', closeSession, 'quiet', busy));
  const steps = h('ol', { class: 'stepper', 'aria-label': '학습 진행' }, ['goal', 'confirm', 'coding', 'questions', 'evaluation'].map((stage, i) => h('li', { class: stage === s.stage ? 'current' : '' }, h('span', {}, String(i + 1).padStart(2, '0')), STAGES[stage])));
  const content = ['goal', 'confirm'].includes(s.stage) ? goalView(s) : h('div', { class: 'learning-grid' }, h('div', { class: 'coding-column' }, taskDetails(t, true), editorView(s)), mentorView(s));
  return h('div', {}, heading, steps, privacyControl(), content);
}
function goalView(s) {
  const busy = isBusy(s), t = taskOf(s);
  const input = h('textarea', { rows: 4, maxlength: 1500, placeholder: '예: 배열에서 최댓값을 찾고, 반복문의 경계를 설명하고 싶어요.', value: s.goalDraft, disabled: busy });
  input.addEventListener('input', safe(() => { commit({ type: 'goalDraft', goal: input.value }, false); const confirm = document.querySelector('#confirm-task'); if (confirm) confirm.disabled = input.value !== current(state).goal; }));
  const request = () => { if (input.value !== current(state).goal) commit({ type: 'goal', goal: input.value }, false); return ask('plan'); };
  return h('div', { class: 'goal-grid' }, panel('무엇을 배우고 싶나요?', h('div', { class: 'panel-body' }, field('나의 목표', input),
    h('div', { class: 'suggestions' }, ...['배열에서 최댓값 찾기', '문자열 길이 함수 만들기', '포인터로 두 정수 교환하기'].map(goal => button(goal, () => { commit({ type: 'goal', goal }); }, 'chip', busy))),
    small(`${state.profile.facts.minutes}분 안에 설명하고 개선할 수 있는 크기로 나눕니다.`), button(busy ? '과제를 준비하고 있어요…' : '과제 제안 받기', request, 'primary', busy),
    s.goalHistory.length ? small(`목표 변경 이력 ${s.goalHistory.length}개 · 이전 제출본과 평가는 보존됩니다.`) : null)),
    t ? panel('제안된 과제', h('div', { class: 'panel-body' }, small(t.message), taskDetails(t), button('이 과제로 시작하기', () => commit({ type: 'confirm' }), 'primary full', busy || s.goalDraft !== s.goal, { id: 'confirm-task' }), small('목표를 수정했다면 과제를 다시 제안받아 주세요.'))) : h('aside', { class: 'goal-empty' }, h('span', { class: 'empty-symbol' }, '01 / 05'), h('h2', {}, '목표를 먼저,', h('br'), '기준은 함께.'), h('p', {}, '과제를 받으면 입력 조건과 완료 기준을 확인하세요. 동의한 기준으로만 코드와 설명을 살펴봅니다.'), h('div', { class: 'mini-facts' }, h('span', {}, '언어', h('strong', {}, 'C17')), h('span', {}, '가용 시간', h('strong', {}, `${state.profile.facts.minutes}분`)))));
}
function taskDetails(task, collapsible = false) {
  const t = task.data;
  const body = h('div', { class: 'task-body' }, h('dl', { class: 'task-spec' }, h('dt', {}, '목표'), h('dd', {}, t.objective), h('dt', {}, '입력 조건'), h('dd', {}, t.input), h('dt', {}, '요구 동작'), h('dd', {}, t.behavior)), h('h3', {}, '완료 기준'), h('ul', { class: 'criteria-list' }, t.criteria.map(c => h('li', {}, c))), h('h3', {}, '허용·제한 사항'), h('ul', { class: 'plain-list' }, t.restrictions.map(r => h('li', {}, r))), h('div', { class: 'tags' }, badge(t.difficulty, 'blue'), ...t.concepts.map(c => badge(c))));
  if (!collapsible) return body;
  return h('details', { class: 'task-details' }, h('summary', {}, h('span', {}, '확정한 과제와 완료 기준'), badge(`${t.criteria.length}개 기준`)), body, button('목표 변경', () => editGoalDialog(), 'quiet', isBusy(current(state))));
}
function editGoalDialog() {
  const input = h('textarea', { rows: 4, value: current(state).goal, maxlength: 1500, 'aria-label': '변경할 학습 목표' });
  const modal = dialog('학습 목표 변경', h('div', {}, small('기존 제출본·질문·평가는 이전 과제에 보존됩니다. 새 기준을 제안받고 확정한 후 다시 제출합니다.'), input), [button('새 목표로 변경', () => { assert(input.value.trim(), '목표를 입력하세요.'); commit({ type: 'goal', goal: input.value }); modal.close(); }, 'primary')]);
}
function editorView(s) {
  const busy = isBusy(s), v = versionOf(s), hasDiff = v && v.code !== s.draft;
  let navigateWithTab = false;
  const numbers = h('pre', { class: 'line-numbers', 'aria-hidden': true }, s.draft.split('\n').map((_, i) => i + 1).join('\n'));
  const code = h('textarea', { class: 'code-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', maxlength: LIMITS.code, 'aria-label': 'C 코드 편집기', 'aria-describedby': 'editor-help', value: s.draft });
  code.addEventListener('input', () => { try { commit({ type: 'draft', code: code.value }, false); } catch (error) { code.value = current(state).draft; notify(error.message, true); } numbers.textContent = code.value.split('\n').map((_, i) => i + 1).join('\n'); document.querySelector('#draft-state').textContent = versionOf(current(state))?.code === code.value ? '제출본과 동일' : '편집 중'; });
  code.addEventListener('scroll', () => { numbers.scrollTop = code.scrollTop; });
  code.addEventListener('keydown', safe(event => {
    if (event.key === 'Escape') { navigateWithTab = true; notify('다음 Tab을 누르면 편집기 밖으로 이동합니다.'); }
    if (event.key === 'Tab' && !event.shiftKey && !navigateWithTab) { event.preventDefault(); code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submitCode(); }
  }));
  code.addEventListener('blur', () => { navigateWithTab = false; });
  async function submitCode() { commit({ type: 'submit' }); await ask('question'); }
  return h('section', { class: 'editor-panel' }, h('div', { class: 'editor-toolbar' }, h('div', { class: 'file-tab' }, h('span', { class: 'c-file-icon' }, 'C'), 'main.c'), h('div', { class: 'editor-meta' }, h('span', { id: 'draft-state' }, hasDiff ? '편집 중' : v ? '제출본과 동일' : '작성 중'), h('span', {}, 'C17'))),
    h('div', { class: 'code-area' }, numbers, code),
    h('div', { class: 'editor-status' }, h('span', { id: 'editor-help' }, 'Tab 들여쓰기 · Esc 후 Tab 이동 · Ctrl+Enter 제출'), h('span', {}, 'UTF-8')),
    h('div', { class: 'editor-footer' }, h('div', {}, h('strong', {}, v ? `평가 대상 ${versionName(s, v.id)}` : '아직 제출하지 않았습니다'), small('제출본은 편집해도 바뀌지 않습니다.')), button(busy ? '요청 진행 중…' : '코드 제출', submitCode, 'primary', busy)),
    s.versions.length ? h('div', { class: 'version-bar' }, h('span', {}, '제출 이력'), ...s.versions.map(v => button(versionName(s, v.id), () => showVersion(s, v.id), `version-chip ${v.id === s.versionId ? 'selected' : ''}`))) : null);
}
function mentorView(s) {
  const busy = isBusy(s), questions = questionsOf(s), evaluation = evaluationOf(s);
  let content;
  if (s.stage === 'coding') content = h('div', { class: 'mentor-empty' }, h('span', { class: 'mentor-initial' }, 'C'), h('h3', {}, '어떤 생각으로 작성했나요?'), h('p', {}, '코드를 제출하면 주요 선택과 경계 조건을 설명하는 질문을 받습니다.'), small('작성 중인 코드는 저장할 수 있습니다. 제출 후에도 계속 수정할 수 있어요.'));
  else if (s.stage === 'evaluation') content = h('div', { class: 'mentor-result' }, badge('실행하지 않은 코드의 추론 평가', 'neutral'), h('h3', {}, s.source === 'demo' ? '모의 평가가 도착했어요' : '코드와 설명을 함께 보았습니다'), h('p', {}, evaluation.data.summary), h('div', { class: 'mini-rubric' }, evaluation.data.criteria.map(c => h('div', {}, h('span', {}, c.name), badge(c.verdict, verdictClass(c.verdict))))), button('근거와 평가 자세히 보기', () => switchView('results'), 'primary full'), button('코드 수정하기', () => commit({ type: 'revise' }), 'outline full', busy));
  else content = h('div', { class: 'question-list' }, questions.length ? questions.map((q, i) => questionCard(s, q, i)) : h('div', { class: 'mentor-empty' }, h('h3', {}, busy ? '제출본을 살펴보고 있어요' : '설명 질문을 받아 보세요'), h('p', {}, '질문 요청이 실패해도 제출본은 그대로 보존됩니다.'), !busy ? button('질문 다시 요청', () => ask('question'), 'primary') : null),
    questions.length && questions.every(q => q.answer !== null) ? h('div', { class: 'answers-complete' }, small('답변을 모두 기록했습니다. 설명과 코드를 비교해 볼까요?'), button('코드와 설명 평가받기', () => ask('evaluate'), 'primary full', busy), button('추가 질문 받기', () => ask('question'), 'quiet full', busy)) : null);
  return h('aside', { class: 'mentor-panel' }, h('div', { class: 'mentor-heading' }, h('span', { class: 'mentor-icon' }, '✳'), h('div', {}, h('h2', {}, '학습 대화'), small(s.source === 'demo' ? '모의 튜터' : connection.model)), s.versionId ? badge(versionName(s, s.versionId), 'blue') : null),
    busy ? h('div', { class: 'busy-banner', role: 'status' }, h('span', { class: 'spinner' }), `코드와 답변을 검토하고 있습니다. 최대 ${AI_TIMEOUT_MS / 60000}분 정도 걸릴 수 있습니다…`) : null, h('div', { class: 'mentor-content' }, content, ...s.hints.filter(h => h.taskId === s.taskId).map(item => h('details', { class: 'help-card', open: true }, h('summary', {}, item.kind === 'hint' ? '사용한 힌트' : '요청한 전체 해설'), h('p', { class: 'prewrap' }, item.text)))),
    h('div', { class: 'mentor-footer' }, button('힌트 요청', () => ask('hint'), 'quiet', busy), button('전체 해설 요청', () => { if (window.confirm('전체 해설을 요청할까요? 도움 사용 이력이 평가에 반영됩니다.')) return ask('explain'); }, 'quiet', busy), small(`도움 이력 ${s.hints.filter(h => h.taskId === s.taskId).length}회 · 전체 정답은 요청할 때만 제공합니다.`)));
}
function questionCard(s, q, i) {
  const busy = isBusy(s);
  const input = h('textarea', { rows: 4, maxlength: 6000, disabled: busy, placeholder: '변수의 값이 어떻게 바뀌는지, 왜 그렇게 작성했는지 설명해 주세요.', value: q.answerDraft, 'aria-label': `질문 ${i + 1}에 대한 설명`, oninput: safe(event => commit({ type: 'answerDraft', id: q.id, answer: event.target.value }, false)) });
  return h('article', { class: 'question-card' }, h('div', { class: 'question-top' }, stamp(`질문 ${String(i + 1).padStart(2, '0')}`), button(`L${q.startLine}–${q.endLine}`, () => showVersion(s, q.versionId, q.startLine, q.endLine), 'line-link')), h('p', { class: 'question-text' }, q.text),
    q.answer !== null ? h('div', { class: 'answer-bubble' }, h('span', {}, '나의 설명'), h('p', { class: 'prewrap' }, q.answer)) : h('div', {}, input, button('답변 기록', () => commit({ type: 'answer', id: q.id, answer: input.value }), 'outline', busy), small('답변 기록 후 모든 질문에 답하면 ‘코드와 설명 평가받기’로 AI에 전송합니다.')));
}
const verdictClass = verdict => verdict === '충족' ? 'green' : verdict === '미충족' ? 'red' : verdict === '일부 충족' ? 'amber' : 'neutral';
function evidenceView(s, evidence) {
  let label = evidence.kind === 'code' ? `${versionName(s, evidence.reference)} · L${evidence.startLine}–${evidence.endLine}` : evidence.kind === 'answer' ? '사용자 답변' : '과제 기준';
  return h('div', { class: 'evidence' }, evidence.kind === 'code' ? button(label, () => showVersion(s, evidence.reference, evidence.startLine, evidence.endLine), 'line-link') : h('span', { class: 'evidence-label' }, label), h('blockquote', {}, evidence.quote));
}
function resultView() {
  const s = current(state), e = evaluationOf(s), busy = isBusy(s);
  if (!s) return h('div', { class: 'empty-state' }, h('h1', {}, '아직 평가가 없습니다'), h('p', {}, '학습 세션에서 코드를 작성하고 설명한 후 결과를 확인할 수 있습니다.'), button('학습 공간으로', () => switchView('workspace'), 'primary'));
  return h('div', {}, h('div', { class: 'section-title workspace-title' }, h('div', {}, stamp(s.source === 'demo' ? 'DEMO REVIEW' : 'LEARNING REVIEW'), h('h1', {}, s.stage === 'closed' ? '이번 학습을 돌아봅니다' : '코드와 설명의 연결'), h('p', { class: 'lead' }, s.goal || '학습 목표를 정하기 전 종료한 세션')), button('학습 공간으로', () => switchView('workspace'), 'outline')),
    h('div', { class: 'notice' }, h('strong', {}, '실행하지 않은 코드의 추론 평가'), h('span', {}, '컴파일·테스트 통과를 보장하지 않습니다. 확신도는 모델의 자기평가이며 정확도 확률이 아닙니다.')),
    s.source === 'demo' ? h('div', { class: 'notice demo' }, h('strong', {}, '모의 결과'), h('span', {}, '아래 판정은 화면과 데이터 흐름을 확인하기 위한 예시입니다. 숙련도를 갱신하지 않습니다.')) : null,
    h('section', { class: 'review-summary' }, h('div', {}, badge(s.outcome ? ({ completed: '완료 기준 충족 추정', stopped: '조기 종료 · 일부 관찰', demo: '모의 세션 종료' })[s.outcome.status] : '평가 검토 중', 'blue'), h('h2', {}, e ? `${versionName(s, e.versionId)} 평가` : '관찰이 충분하지 않습니다'), h('p', {}, e?.data.summary ?? s.outcome?.summary ?? '먼저 제출 코드에 대한 질문에 답변하고 평가를 요청하세요.')), e ? button('평가한 제출본 보기', () => showVersion(s, e.versionId), 'outline') : null),
    e ? h('div', { class: 'rubric-grid' }, e.data.criteria.map(c => panel(null, h('div', { class: 'rubric-card' }, h('div', { class: 'rubric-heading' }, h('h2', {}, c.name), badge(c.verdict, verdictClass(c.verdict))), h('p', {}, c.reason), ...c.evidence.map(item => evidenceView(s, item)), h('div', { class: 'next-action' }, h('strong', {}, '다음 행동'), h('p', {}, c.nextAction)), small(`확신도 · ${c.confidence}`))))) : null,
    e ? h('div', { class: 'result-bottom' }, panel('가정과 평가 한계', h('div', { class: 'panel-body' }, h('ul', { class: 'plain-list' }, e.data.limitations.map(item => h('li', {}, item))))), panel('다음 학습 제안', h('div', { class: 'panel-body' }, h('ul', { class: 'plain-list' }, e.data.nextSteps.map(item => h('li', {}, item)))))) : null,
    s.stage === 'closed' ? changesView(s) : e ? h('div', { class: 'review-actions' }, button('코드 수정하기', () => { commit({ type: 'revise' }); switchView('workspace'); }, 'outline', busy), button('평가 정정 요청', () => correctionDialog(e), 'quiet', busy), button('세션 종료 · 수준 갱신', closeSession, 'primary', busy), small('수준은 세션 종료 시 근거를 확인한 후 갱신합니다. 정정 요청이 미해결인 평가는 수준을 변경하지 않습니다.')) : null,
    s.corrections.length ? panel('평가 정정 이력', h('div', { class: 'panel-body' }, s.corrections.map(c => h('p', {}, `${time(c.createdAt)} · ${c.reason}`)))) : null);
}
function correctionDialog(e) {
  const reason = h('textarea', { rows: 4, maxlength: 3000, 'aria-label': '평가 정정 이유', placeholder: '어떤 판정이나 근거가 잘못되었다고 생각하나요?' });
  const modal = dialog('평가 정정 요청', h('div', {}, small('현재 평가를 보존하고 정정 이유를 기록합니다. 다시 평가하면 이 이유도 함께 전달합니다.'), reason), [button('정정 기록 후 재평가', async () => { commit({ type: 'correction', reason: reason.value }); modal.close(); await ask('evaluate'); }, 'primary'), button('정정 요청만 기록', () => { commit({ type: 'correction', reason: reason.value }); modal.close(); }, 'outline')]);
}
function changesView(s) {
  const changes = state.changes.filter(c => c.sessionId === s.id);
  return panel('개념별 수준 변화', h('div', { class: 'panel-body' }, changes.length ? h('div', { class: 'change-list' }, changes.map(c => h('div', {}, h('strong', {}, c.concept), h('p', {}, `${c.before} → ${c.after}`), small(c.reason)))) : h('p', {}, '이 세션에서 반영한 수준 변화가 없습니다. 관찰이 부족하거나 모의 학습인 경우 기존 수준을 유지합니다.'), button('결과를 JSON으로 저장', exportJson, 'primary')));
}
function profileView() {
  return h('div', {}, h('div', { class: 'section-title' }, stamp('LEARNER PROFILE'), h('h1', {}, '나의 학습 프로필'), h('p', { class: 'lead' }, '내가 알려 준 정보와 관찰을 통해 추정한 수준을 구분합니다.')), h('div', { class: 'profile-grid' }, panel('내가 알려 준 정보', h('div', { class: 'panel-body' }, profileForm(true))), panel('관찰을 통한 추정 수준', h('div', { class: 'panel-body' }, state.profile.estimates.concepts.map(c => h('div', { class: 'concept-row' }, h('div', {}, h('strong', {}, c.name), small(c.reason)), badge(c.level, c.level === '미평가' ? 'neutral' : 'blue'))), small(state.profile.estimates.recommended)))));
}
function historyView() {
  return h('div', {}, h('div', { class: 'section-title' }, stamp('SESSION ARCHIVE'), h('h1', {}, '쌓여 가는 학습 기록'), h('p', { class: 'lead' }, '세션을 선택하면 해당 목표와 코드, 질문, 평가를 확인할 수 있습니다.')), state.sessions.length ? h('div', { class: 'history-list' }, [...state.sessions].reverse().map(s => h('article', { class: 'history-card' }, h('div', {}, badge(s.source === 'demo' ? '모의' : 'AI 학습'), h('h2', {}, s.goal || '목표 설정 중'), small(`${time(s.createdAt)} · 제출 ${s.versions.length}회 · ${STAGES[s.stage]}`)), button('열기', () => { commit({ type: 'select', id: s.id }); switchView('workspace'); }, 'outline', isBusy(current(state)))))) : h('p', { class: 'empty-state' }, '아직 시작한 세션이 없습니다.'));
}
function dialog(title, content, actions = []) {
  const node = h('dialog', { class: 'modal', 'aria-label': title });
  node.append(h('div', { class: 'modal-heading' }, h('h2', {}, title), button('닫기', () => node.close(), 'quiet')), content, h('div', { class: 'modal-actions' }, actions));
  document.body.append(node); node.addEventListener('close', () => node.remove()); node.showModal(); return node;
}
function showVersion(s, id, startLine, endLine) {
  const v = s.versions.find(v => v.id === id), t = s.tasks.find(t => t.id === v.taskId);
  const lines = h('div', { class: 'snapshot-code' }, v.code.split('\n').map((line, i) => h('div', { class: i + 1 >= startLine && i + 1 <= endLine ? 'highlight-line' : '' }, h('span', { class: 'snapshot-number' }, i + 1), h('code', {}, line || ' '))));
  dialog(`${versionName(s, id)} · 제출한 코드`, h('div', {}, small(`${time(v.createdAt)} · ${t.data.title}`), small('제출 당시의 코드입니다. 현재 편집 중인 코드와 다를 수 있습니다.'), lines));
}

window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); document.querySelector('#main')?.focus(); });
window.addEventListener('keydown', safe(event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); exportJson(); } }));

async function registerAgentTools() {
  if (!document.modelContext?.registerTool) return;
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const tools = [{
    name: 'read_learning_state', title: '현재 학습 상태 읽기', description: '현재 목표, 단계, 제출 버전과 미답변 질문을 읽습니다. 외부 API 요청이나 상태 변경을 하지 않습니다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute(input) { assert(input && typeof input === 'object' && Object.keys(input).length === 0, '입력이 없어야 합니다.'); const s = current(state); return { stage: s?.stage ?? 'setup', goal: s?.goal ?? '', source: s?.source ?? null, version: s?.versionId ?? null, pendingQuestions: s ? questionsOf(s).filter(q => q.answer === null).map(q => ({ id: q.id, text: q.text })) : [] }; }
  }, {
    name: 'stage_c_draft', title: 'C 코드 초안 편집', description: '현재 세션의 작성 중 코드만 바꿉니다. 제출·실행·평가·API 호출은 하지 않습니다.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', maxLength: LIMITS.code } }, required: ['code'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute(input) { assert(input && Object.keys(input).length === 1 && typeof input.code === 'string', 'code 문자열 하나가 필요합니다.'); commit({ type: 'draft', code: input.code }); return { savedAsDraft: true, submitted: false, characters: current(state).draft.length }; }
  }];
  for (const tool of tools) { try { await document.modelContext.registerTool(tool, { signal: lifecycle.signal }); } catch { /* Optional browser capability: the visible UI remains usable. */ } }
}
render();
try {
  const response = await fetch('/api/status', { headers: { Authorization: `Bearer ${launchToken}` }, signal: AbortSignal.timeout(5000) });
  const data = await response.json(); assert(response.ok, data.message);
  connection = { ...data, reachable: true, verified: false }; state.settings.model = data.model;
} catch { connection.reachable = false; }
render();
await registerAgentTools();
