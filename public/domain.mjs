// Shared by the browser and local backend. Imported data never becomes configuration.
export const APP_VERSION = '0.1.0';
export const LIMITS = Object.freeze({ file: 2_000_000, code: 24000, lines: 600, context: 100000, output: 120000 });
export const CONCEPTS = ['타입과 표현식', '조건문', '반복문', '배열', '함수', '포인터', '메모리와 수명', '입출력'];
export const LEVELS = ['미평가', '입문', '연습 중', '독립 적용', '응용'];
export const RUBRIC = ['목표 충족', '논리적 타당성', 'C언어 이해', '의도와 구현의 일치', '설명 능력', '경계 조건 이해', '독립 해결 정도'];
export const ACTIONS = ['plan', 'question', 'evaluate', 'hint', 'explain'];
export const STAGES = { goal: '목표 설정', confirm: '과제 확인', coding: '코드 작성', questions: '코드 설명', evaluation: '평가와 수정', closed: '세션 종료' };
const str = (maxLength = 3000, minLength = 0) => ({ type: 'string', minLength, maxLength });
const en = values => ({ type: 'string', enum: values });
const num = (minimum = 0, maximum = 1000) => ({ type: 'integer', minimum, maximum });
const arr = (items, maxItems = 100, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const id = { ...str(90, 3), pattern: '^[a-z][a-z0-9-]+$' };
const date = { ...str(30, 20), pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
const boolean = { type: 'boolean' };
const source = en(['live', 'demo']);
const factsSchema = obj({ education: str(120), experience: str(700), purpose: str(700, 1), selfRating: en(['처음 시작', '기초 문법 학습', '작은 프로그램 작성', '프로젝트 경험']), explanationStyle: en(['작은 예시부터', '원리와 수식 중심', '질문하며 단계별로']), minutes: num(5, 120) });
const conceptSchema = obj({ name: en(CONCEPTS), level: en(LEVELS), reason: str(1500), evidence: arr(id, 30) });
const profileSchema = obj({ facts: factsSchema, estimates: obj({ concepts: arr(conceptSchema, 8, 8), recommended: str(1500) }) });
export const taskSchema = obj({ title: str(120, 1), objective: str(1200, 1), input: str(1800, 1), behavior: str(1800, 1), restrictions: arr(str(600, 1), 8, 1), criteria: arr(str(600, 1), 8, 1), concepts: arr(en(CONCEPTS), 8, 1), difficulty: en(['입문', '기초', '중급']) });
const evidenceSchema = obj({ kind: en(['code', 'answer', 'task']), reference: id, startLine: num(0, 600), endLine: num(0, 600), quote: str(1000, 1) });
export const evaluationSchema = obj({
  summary: str(2000, 1),
  criteria: arr(obj({ name: en(RUBRIC), verdict: en(['충족', '일부 충족', '미충족', '판단 보류']), reason: str(1500, 1), nextAction: str(1000, 1), confidence: en(['낮음', '중간', '높음']), evidence: arr(evidenceSchema, 6) }), 7, 7),
  limitations: arr(str(1200, 1), 8, 1),
  proposals: arr(obj({ concept: en(CONCEPTS), level: en(LEVELS), reason: str(1000, 1), evidence: arr(evidenceSchema, 6, 2) }), 8),
  nextSteps: arr(str(800, 1), 5, 1)
});
export const responseSchemas = {
  plan: obj({ message: str(1800, 1), task: taskSchema }),
  question: obj({ message: str(1800, 1), questions: arr(obj({ text: str(1500, 1), startLine: num(1, 600), endLine: num(1, 600) }), 2, 1) }),
  evaluate: evaluationSchema,
  hint: obj({ message: str(5000, 1) }),
  explain: obj({ message: str(10000, 1) })
};
const taskRecord = obj({ id, createdAt: date, source, confirmed: boolean, message: str(1800, 1), data: taskSchema });
const versionSchema = obj({ id, taskId: id, code: str(LIMITS.code, 1), createdAt: date });
const questionSchema = obj({ id, versionId: id, requestId: id, text: str(1500, 1), startLine: num(1, 600), endLine: num(1, 600), answerDraft: str(6000), answer: nullable(str(6000, 1)), answeredAt: nullable(date) });
const evaluationRecord = obj({ id, versionId: id, taskId: id, requestId: id, source, createdAt: date, data: evaluationSchema });
const hintSchema = obj({ id, versionId: nullable(id), taskId: id, requestId: id, kind: en(['hint', 'explain']), text: str(10000, 1), createdAt: date });
const requestSchema = obj({ id, action: en(ACTIONS), versionId: nullable(id), taskId: nullable(id), status: en(['pending', 'applied', 'failed', 'interrupted']), createdAt: date });
const correctionSchema = obj({ id, evaluationId: id, reason: str(3000, 1), createdAt: date });
const sessionSchema = obj({
  id, createdAt: date, source, stage: en(Object.keys(STAGES)), goal: str(1500), goalDraft: str(1500), goalHistory: arr(obj({ goal: str(1500), changedAt: date }), 30),
  tasks: arr(taskRecord, 30), taskId: nullable(id), draft: str(LIMITS.code), versions: arr(versionSchema, 40), versionId: nullable(id),
  questions: arr(questionSchema, 100), evaluations: arr(evaluationRecord, 50), hints: arr(hintSchema, 60), requests: arr(requestSchema, 200), corrections: arr(correctionSchema, 50),
  outcome: nullable(obj({ status: en(['completed', 'stopped', 'demo']), summary: str(2000, 1), nextSteps: arr(str(800, 1), 5), closedAt: date }))
});
const changeSchema = obj({ id, sessionId: id, evaluationId: id, concept: en(CONCEPTS), before: en(LEVELS), proposed: en(LEVELS), after: en(LEVELS), reason: str(1800, 1), createdAt: date });
export const stateSchema = obj({ schemaVersion: { type: 'integer', enum: [1] }, appVersion: { type: 'string', enum: [APP_VERSION] }, savedAt: date, settings: obj({ standard: en(['C17']), model: str(100, 1), promptVersion: en(['1']) }), profile: nullable(profileSchema), activeSessionId: nullable(id), sessions: arr(sessionSchema, 30), changes: arr(changeSchema, 200) });
export class ValidationError extends Error {}
export function assert(condition, message) { if (!condition) throw new ValidationError(message); }
export function validate(schema, value, path = '데이터') {
  if (schema.anyOf) {
    assert(schema.anyOf.some(s => { try { validate(s, value, path); return true; } catch { return false; } }), `${path}: 허용되지 않은 값입니다.`);
    return;
  }
  if (schema.enum) assert(schema.enum.includes(value), `${path}: 허용되지 않은 값입니다.`);
  switch (schema.type) {
    case 'null': assert(value === null, `${path}: null이어야 합니다.`); break;
    case 'string':
      assert(typeof value === 'string', `${path}: 문자열이어야 합니다.`);
      assert(value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity), `${path}: 문자열 길이를 확인하세요.`);
      if (schema.pattern) assert(new RegExp(schema.pattern).test(value), `${path}: 형식이 올바르지 않습니다.`);
      break;
    case 'integer': assert(Number.isInteger(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), `${path}: 정수 범위를 확인하세요.`); break;
    case 'boolean': assert(typeof value === 'boolean', `${path}: 참/거짓이어야 합니다.`); break;
    case 'array':
      assert(Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems, `${path}: 목록 크기를 확인하세요.`);
      value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`)); break;
    case 'object':
      assert(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, `${path}: 객체이어야 합니다.`);
      assert(Object.keys(value).length === schema.required.length && schema.required.every(key => Object.hasOwn(value, key)), `${path}: 필수 항목이 없거나 알 수 없는 항목이 있습니다.`);
      for (const key of schema.required) validate(schema.properties[key], value[key], `${path}.${key}`);
      break;
    default: throw new ValidationError('지원하지 않는 스키마입니다.');
  }
}
export const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
export const current = state => state.sessions.find(s => s.id === state.activeSessionId) ?? null;
export const taskOf = s => s?.tasks.find(t => t.id === s.taskId) ?? null;
export const versionOf = s => s?.versions.find(v => v.id === s.versionId) ?? null;
export const questionsOf = s => s?.questions.filter(q => q.versionId === s.versionId) ?? [];
export const evaluationOf = s => s?.evaluations.filter(e => e.versionId === s.versionId && e.taskId === s.taskId).at(-1) ?? null;
export const isBusy = s => s?.requests.some(r => r.status === 'pending') ?? false;
const starter = '#include <stdio.h>\n\nint main(void) {\n    // 목표에 맞는 코드를 작성해 보세요.\n\n    return 0;\n}\n';
export function emptyState(model = 'gpt-5-mini') { return { schemaVersion: 1, appVersion: APP_VERSION, savedAt: now(), settings: { standard: 'C17', model, promptVersion: '1' }, profile: null, activeSessionId: null, sessions: [], changes: [] }; }
const taskText = task => [task.data.title, task.data.objective, task.data.input, task.data.behavior, ...task.data.restrictions, ...task.data.criteria].join('\n');
function validateEvidence(evidence, version, task, questions) {
  let text;
  if (evidence.kind === 'code') {
    assert(version && evidence.reference === version.id, '근거의 코드 버전이 다릅니다.');
    const lines = version.code.split('\n');
    assert(evidence.startLine >= 1 && evidence.endLine >= evidence.startLine && evidence.endLine <= lines.length, '근거의 코드 줄 번호가 유효하지 않습니다.');
    text = lines.slice(evidence.startLine - 1, evidence.endLine).join('\n');
  } else {
    assert(evidence.startLine === 0 && evidence.endLine === 0, '코드 외 근거에는 줄 번호를 지정할 수 없습니다.');
    if (evidence.kind === 'answer') {
      const q = questions.find(q => q.id === evidence.reference && q.versionId === version?.id && q.answer !== null);
      assert(q, '근거가 가리키는 답변이 없습니다.'); text = q.answer;
    } else { assert(task && evidence.reference === task.id, '근거의 과제 참조가 잘못되었습니다.'); text = taskText(task); }
  }
  assert(evidence.quote.trim().length > 0 && text.includes(evidence.quote), '근거 인용문이 원문에 존재하지 않습니다.');
}
export function validateResponse(action, data, context) {
  assert(ACTIONS.includes(action), '알 수 없는 요청입니다.'); validate(responseSchemas[action], data, 'AI 응답');
  if (action === 'plan') assert(new Set(data.task.concepts).size === data.task.concepts.length, '개념이 중복되었습니다.');
  if (action === 'question') {
    assert(context.version, '질문 대상 코드가 없습니다.');
    const lines = context.version.code.split('\n').length;
    for (const q of data.questions) assert(q.endLine >= q.startLine && q.endLine <= lines, '질문이 코드 범위를 벗어났습니다.');
  }
  if (action === 'evaluate') {
    assert(context.version && context.task && context.questions.some(q => q.answer !== null), '평가에는 코드와 답변이 필요합니다.');
    assert(new Set(data.criteria.map(c => c.name)).size === RUBRIC.length, '평가 항목이 중복되거나 누락되었습니다.');
    assert(new Set(data.proposals.map(p => p.concept)).size === data.proposals.length, '수준 변경안이 중복되었습니다.');
    for (const c of data.criteria) {
      assert(c.verdict === '판단 보류' || c.evidence.length > 0, '확정 판정에는 근거가 필요합니다.');
      c.evidence.forEach(e => validateEvidence(e, context.version, context.task, context.questions));
    }
    for (const p of data.proposals) {
      assert(context.task.data.concepts.includes(p.concept), '과제 범위 밖의 개념 변경안입니다.');
      assert(p.evidence.some(e => e.kind === 'code') && p.evidence.some(e => e.kind === 'answer'), '수준 변경에는 코드와 답변 근거가 모두 필요합니다.');
      p.evidence.forEach(e => validateEvidence(e, context.version, context.task, context.questions));
    }
  }
  return data;
}
export function validateState(state) {
  validate(stateSchema, state);
  const ids = new Set();
  const unique = records => records.forEach(record => { assert(!ids.has(record.id), '중복 ID가 있습니다.'); ids.add(record.id); });
  unique(state.sessions); unique(state.changes);
  assert(!state.activeSessionId || current(state), '현재 세션 참조가 유효하지 않습니다.');
  assert(state.profile || !state.sessions.length, '프로필 없이 세션을 복원할 수 없습니다.');
  if (state.profile) assert(new Set(state.profile.estimates.concepts.map(c => c.name)).size === 8, '프로필 개념이 중복되었습니다.');
  for (const s of state.sessions) {
    [s.tasks, s.versions, s.questions, s.evaluations, s.hints, s.requests, s.corrections].forEach(unique);
    const t = taskOf(s), v = versionOf(s);
    assert(!s.taskId || t, '현재 과제가 없습니다.'); assert(!s.versionId || (v && v.taskId === s.taskId), '현재 코드 참조가 잘못되었습니다.');
    assert(isBusy(s) ? s.requests.filter(r => r.status === 'pending').length === 1 : true, '진행 중인 요청은 하나여야 합니다.');
    assert((s.stage === 'closed') === (s.outcome !== null), '종료 상태가 일치하지 않습니다.');
    if (s.stage === 'confirm') assert(t && !t.confirmed, '확인할 과제가 없습니다.');
    if (['coding', 'questions', 'evaluation'].includes(s.stage)) assert(t?.confirmed, '확정된 과제가 없습니다.');
    if (['questions', 'evaluation'].includes(s.stage)) assert(v, '제출된 코드가 없습니다.');
    if (s.stage === 'evaluation') assert(evaluationOf(s), '현재 버전의 평가가 없습니다.');
    assert(s.draft.split('\n').length <= LIMITS.lines, '코드는 600줄 이하로 작성하세요.');
    for (const record of s.tasks) assert(record.source === s.source, '과제의 평가 모드가 일치하지 않습니다.');
    for (const r of s.requests) {
      assert(!r.versionId || s.versions.some(x => x.id === r.versionId), '요청의 코드 참조가 잘못되었습니다.');
      assert(!r.taskId || s.tasks.some(x => x.id === r.taskId), '요청의 과제 참조가 잘못되었습니다.');
    }
    for (const version of s.versions) {
      assert(s.tasks.some(t => t.id === version.taskId && t.confirmed), '코드의 과제 참조가 잘못되었습니다.');
      assert(version.code.split('\n').length <= LIMITS.lines, '제출 코드가 600줄을 넘습니다.');
    }
    for (const q of s.questions) {
      const version = s.versions.find(v => v.id === q.versionId);
      assert(version && q.startLine <= q.endLine && q.endLine <= version.code.split('\n').length, '질문의 코드 참조가 잘못되었습니다.');
      assert(s.requests.some(r => r.id === q.requestId && r.action === 'question' && r.status === 'applied' && r.versionId === q.versionId), '질문의 요청 참조가 잘못되었습니다.');
      assert((q.answer === null) === (q.answeredAt === null), '답변의 저장 상태가 일치하지 않습니다.');
    }
    for (const e of s.evaluations) {
      const version = s.versions.find(v => v.id === e.versionId), task = s.tasks.find(t => t.id === e.taskId);
      assert(version && task && version.taskId === task.id && e.source === s.source, '평가 참조가 잘못되었습니다.');
      assert(s.requests.some(r => r.id === e.requestId && r.action === 'evaluate' && r.status === 'applied' && r.versionId === e.versionId), '평가 요청 참조가 잘못되었습니다.');
      validateResponse('evaluate', e.data, { version, task, questions: s.questions.filter(q => q.versionId === e.versionId) });
    }
    for (const h of s.hints) {
      assert(s.tasks.some(t => t.id === h.taskId) && (!h.versionId || s.versions.some(v => v.id === h.versionId && v.taskId === h.taskId)), '도움 이력 참조가 잘못되었습니다.');
      assert(s.requests.some(r => r.id === h.requestId && r.action === h.kind && r.status === 'applied'), '도움 요청 참조가 잘못되었습니다.');
    }
    for (const c of s.corrections) assert(s.evaluations.some(e => e.id === c.evaluationId), '정정 요청의 평가가 없습니다.');
  }
  for (const c of state.changes) {
    const s = state.sessions.find(s => s.id === c.sessionId);
    assert(s?.stage === 'closed' && s.source === 'live' && s.evaluations.some(e => e.id === c.evaluationId), '수준 갱신 참조가 잘못되었습니다.');
  }
  if (state.profile) for (const c of state.profile.estimates.concepts) for (const evidence of c.evidence) assert(state.sessions.some(s => s.source === 'live' && s.evaluations.some(e => e.id === evidence)), '숙련도 근거가 없습니다.');
  return state;
}
function transaction(state, fn) { const next = structuredClone(state); fn(next); return validateState(next); }
function editable(s) { assert(s && s.stage !== 'closed' && !isBusy(s), '진행 중인 요청을 마친 뒤 다시 시도하세요.'); }
export function reduce(state, event) {
  return transaction(state, next => {
    let s = current(next);
    if (event.type === 'profile') {
      assert(!isBusy(s), '진행 중인 요청이 있습니다.'); validate(factsSchema, event.facts);
      if (next.profile) next.profile.facts = structuredClone(event.facts);
      else next.profile = { facts: structuredClone(event.facts), estimates: { concepts: CONCEPTS.map(name => ({ name, level: '미평가', reason: '아직 코드와 답변을 관찰하지 않았습니다.', evidence: [] })), recommended: '작은 목표로 시작해 코드와 설명을 함께 확인합니다.' } };
      return;
    }
    if (event.type === 'start') {
      assert(next.profile && (!s || s.stage === 'closed'), '진행 중인 세션을 먼저 종료하세요.');
      validate(source, event.source);
      s = { id: uid('session'), createdAt: now(), source: event.source, stage: 'goal', goal: '', goalDraft: '', goalHistory: [], tasks: [], taskId: null, draft: starter, versions: [], versionId: null, questions: [], evaluations: [], hints: [], requests: [], corrections: [], outcome: null };
      next.sessions.push(s); next.activeSessionId = s.id; return;
    }
    if (event.type === 'select') { assert(!isBusy(s), '진행 중인 요청이 있습니다.'); assert(next.sessions.some(x => x.id === event.id), '세션을 찾을 수 없습니다.'); next.activeSessionId = event.id; return; }
    if (event.type === 'draft') { assert(s && s.stage !== 'closed', '코드를 작성할 세션이 없습니다.'); s.draft = event.code; return; }
    editable(s);
    if (event.type === 'goalDraft') { s.goalDraft = event.goal;
    } else if (event.type === 'goal') {
      s.goalDraft = event.goal;
      if (s.goal !== event.goal) { if (s.goal) s.goalHistory.push({ goal: s.goal, changedAt: now() }); s.goal = event.goal; s.taskId = null; s.versionId = null; s.stage = 'goal'; }
    } else if (event.type === 'confirm') { assert(s.stage === 'confirm' && taskOf(s) && s.goalDraft === s.goal, '변경한 목표로 과제를 다시 제안받아 주세요.'); taskOf(s).confirmed = true; s.stage = 'coding';
    } else if (event.type === 'submit') {
      assert(['coding', 'evaluation', 'questions'].includes(s.stage) && taskOf(s)?.confirmed && s.draft.trim(), '확정된 과제와 코드가 필요합니다.');
      assert(!versionOf(s) || versionOf(s).code !== s.draft, '현재 제출본과 같습니다. 코드를 수정하거나 기존 제출본의 평가를 이어가세요.');
      const version = { id: uid('code'), taskId: s.taskId, code: s.draft, createdAt: now() }; s.versions.push(version); s.versionId = version.id; s.stage = 'questions';
    } else if (event.type === 'answerDraft') {
      assert(s.stage === 'questions', '답변 단계가 아닙니다.'); const q = questionsOf(s).find(q => q.id === event.id);
      assert(q && q.answer === null, '미답변 질문이 아닙니다.'); q.answerDraft = event.answer;
    } else if (event.type === 'answer') {
      assert(s.stage === 'questions', '답변 단계가 아닙니다.'); const q = questionsOf(s).find(q => q.id === event.id);
      assert(q && q.answer === null && event.answer.trim(), '미답변 질문에 설명을 입력하세요.'); q.answer = event.answer; q.answerDraft = ''; q.answeredAt = now();
    } else if (event.type === 'revise') { assert(s.stage === 'evaluation' || s.stage === 'questions', '수정할 제출본이 없습니다.'); s.stage = 'coding';
    } else if (event.type === 'correction') {
      const e = evaluationOf(s); assert(e && event.reason.trim(), '평가와 정정 이유가 필요합니다.');
      s.corrections.push({ id: uid('correction'), evaluationId: e.id, reason: event.reason, createdAt: now() });
    } else if (event.type === 'close') {
      const evaluation = evaluationOf(s);
      const complete = evaluation && evaluation.data.criteria.every(c => c.verdict === '충족') && s.draft === versionOf(s)?.code;
      s.stage = 'closed'; s.outcome = { status: s.source === 'demo' ? 'demo' : complete ? 'completed' : 'stopped', summary: evaluation?.data.summary ?? '평가를 완료하기 전에 세션을 종료했습니다. 관찰하지 못한 개념의 수준은 유지합니다.', nextSteps: evaluation?.data.nextSteps ?? ['저장한 목표를 바탕으로 다음 세션에서 이어서 연습하세요.'], closedAt: now() };
      if (evaluation && s.source === 'live') applyProposals(next, s, evaluation);
    } else throw new ValidationError('허용되지 않은 상태 변경입니다.');
  });
}
function applyProposals(state, s, evaluation) {
  for (const p of evaluation.data.proposals) {
    const c = state.profile.estimates.concepts.find(c => c.name === p.concept);
    const before = c.level;
    const observed = state.sessions.filter(s => s.source === 'live' && s.evaluations.some(e => e.data.proposals.some(p2 => p2.concept === p.concept)));
    let target = LEVELS.indexOf(p.level), from = LEVELS.indexOf(before);
    let reason = p.reason;
    const disputed = s.corrections.some(c => c.evaluationId === evaluation.id);
    const assisted = s.hints.some(h => h.taskId === evaluation.taskId);
    const strong = evaluation.data.criteria.every(c => c.verdict === '충족');
    if (disputed || (target >= 3 && (observed.length < (target === 4 ? 3 : 2) || assisted || !strong)) || (target < from && observed.length < 2)) {
      target = from; reason += ' · 관찰 횟수·도움 이력·미해결 정정 요청을 고려하여 기존 수준을 유지했습니다.';
    }
    target = Math.max(from - 1, Math.min(target, from + 1));
    const after = LEVELS[target];
    c.level = after; c.reason = reason; c.evidence = [...new Set([...c.evidence, evaluation.id])].slice(-30);
    state.changes.push({ id: uid('change'), sessionId: s.id, evaluationId: evaluation.id, concept: p.concept, before, proposed: p.level, after, reason, createdAt: now() });
  }
  state.profile.estimates.recommended = evaluation.data.nextSteps.join('\n').slice(0, 1500);
}
export function allowedAction(s, action) {
  assert(s && s.stage !== 'closed' && !isBusy(s), '현재 요청을 완료한 뒤 다시 시도하세요.');
  if (action === 'plan') assert(['goal', 'confirm'].includes(s.stage) && s.goal.trim(), '먼저 학습 목표를 입력하세요.');
  else if (action === 'question') assert(s.stage === 'questions' && versionOf(s) && questionsOf(s).every(q => q.answer !== null), '먼저 제출하거나 남은 질문에 답변하세요.');
  else if (action === 'evaluate') assert(['questions', 'evaluation'].includes(s.stage) && questionsOf(s).length > 0 && questionsOf(s).every(q => q.answer !== null), '제출한 코드에 대한 질문에 먼저 답변하세요.');
  else assert(['coding', 'questions', 'evaluation'].includes(s.stage), '과제 확정 후 도움을 요청할 수 있습니다.');
}
export function beginRequest(state, action) {
  let requestId;
  const next = transaction(state, next => { const s = current(next); assert(ACTIONS.includes(action), '알 수 없는 요청입니다.'); allowedAction(s, action); requestId = uid('request'); s.requests.push({ id: requestId, action, taskId: s.taskId, versionId: s.versionId, status: 'pending', createdAt: now() }); });
  return { state: next, requestId };
}
export function failRequest(state, requestId) { return transaction(state, next => { const r = current(next)?.requests.find(r => r.id === requestId); if (r?.status === 'pending') r.status = 'failed'; }); }
export function makeContext(state) {
  const s = current(state); assert(s && state.profile, '세션과 프로필이 필요합니다.');
  const { education, ...facts } = state.profile.facts;
  return { facts, estimates: structuredClone(state.profile.estimates), goal: s.goal, stage: s.stage, source: s.source, task: taskOf(s), version: versionOf(s), draft: s.draft, questions: questionsOf(s).map(q => ({ ...q, answerDraft: '' })), hints: s.hints.filter(h => h.taskId === s.taskId), evaluations: s.evaluations.filter(e => e.versionId === s.versionId), corrections: s.corrections.filter(c => s.evaluations.some(e => e.id === c.evaluationId && e.versionId === s.versionId)), revisionHistory: s.versions.filter(v => v.taskId === s.taskId && v.id !== s.versionId).map(v => ({ id: v.id, createdAt: v.createdAt, code: v.code })), goalHistory: s.goalHistory };
}
const { education: omittedEducation, ...apiFacts } = factsSchema.properties;
export const contextSchema = obj({ facts: obj(apiFacts), estimates: profileSchema.properties.estimates, goal: str(1500, 1), stage: en(Object.keys(STAGES)), source, task: nullable(taskRecord), version: nullable(versionSchema), draft: str(LIMITS.code), questions: arr(questionSchema, 100), hints: arr(hintSchema, 60), evaluations: arr(evaluationRecord, 50), corrections: arr(correctionSchema, 50), revisionHistory: arr(obj({ id, createdAt: date, code: str(LIMITS.code, 1) }), 40), goalHistory: sessionSchema.properties.goalHistory });
export function applyResponse(state, requestId, data) {
  const old = current(state)?.requests.find(r => r.id === requestId);
  if (old?.status === 'applied') return state;
  return transaction(state, next => {
    const s = current(next), r = s?.requests.find(r => r.id === requestId);
    assert(r?.status === 'pending' && r.versionId === s.versionId && r.taskId === s.taskId, '이전 요청의 결과는 적용할 수 없습니다.');
    const context = makeContext(next); validateResponse(r.action, data, context); r.status = 'applied';
    if (r.action === 'plan') { const t = { id: uid('task'), createdAt: now(), source: s.source, confirmed: false, message: data.message, data: structuredClone(data.task) }; s.tasks.push(t); s.taskId = t.id; s.stage = 'confirm'; }
    if (r.action === 'question') for (const q of data.questions) s.questions.push({ id: uid('question'), versionId: s.versionId, requestId, ...q, answerDraft: '', answer: null, answeredAt: null });
    if (r.action === 'evaluate') { s.evaluations.push({ id: uid('evaluation'), versionId: s.versionId, taskId: s.taskId, requestId, source: s.source, createdAt: now(), data: structuredClone(data) }); s.stage = 'evaluation'; }
    if (r.action === 'hint' || r.action === 'explain') s.hints.push({ id: uid('help'), versionId: s.versionId, taskId: s.taskId, requestId, kind: r.action, text: data.message, createdAt: now() });
  });
}
export function serialize(state) { const snapshot = structuredClone(state); snapshot.savedAt = now(); validateState(snapshot); const json = JSON.stringify(snapshot, null, 2); assert(new TextEncoder().encode(json).length <= LIMITS.file, '저장 파일은 2 MB 이하이어야 합니다.'); return json; }
export function restore(text) {
  assert(new TextEncoder().encode(text).length <= LIMITS.file, '2 MB 이하의 JSON 파일을 선택하세요.');
  let parsed; try { parsed = JSON.parse(text); } catch { throw new ValidationError('올바른 JSON 파일이 아닙니다.'); }
  validateState(parsed);
  for (const s of parsed.sessions) for (const r of s.requests) if (r.status === 'pending') r.status = 'interrupted';
  return parsed;
}
