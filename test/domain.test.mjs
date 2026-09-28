import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, current, questionsOf, versionOf, taskOf, reduce, beginRequest, applyResponse, makeContext, serialize, restore, validateState, validateResponse, evaluationOf } from '../public/domain.mjs';
import { demoResponse } from '../lib/tutor.mjs';
import { answered, prepared, respond, realEvaluation, facts, code } from './helpers.mjs';

test('모의 전체 세션: 설문 → 확정 → 제출/설명 → 평가 → 종료 → 파일 복원', () => {
  let state = answered(); state = respond(state, 'evaluate').state; state = reduce(state, { type: 'close' });
  assert.equal(current(state).stage, 'closed'); assert.equal(current(state).outcome.status, 'demo');
  assert.equal(state.changes.length, 0); assert.ok(state.profile.estimates.concepts.every(c => c.level === '미평가'));
  const restored = restore(serialize(state)); assert.deepEqual(restored.sessions, state.sessions); assert.deepEqual(restored.profile, state.profile);
});
test('제출본은 편집 후에도 보존되고 질문과 평가는 제출 버전에 연결된다', () => {
  let state = answered(); const original = structuredClone(versionOf(current(state)));
  state = reduce(state, { type: 'draft', code: 'int changed_draft = 42;' });
  state = respond(state, 'evaluate').state;
  assert.deepEqual(versionOf(current(state)), original); assert.equal(evaluationOf(current(state)).versionId, original.id);
  assert.equal(current(state).draft, 'int changed_draft = 42;');
});
test('진행 중 저장과 복원: 미답변 질문/초안을 유지하며 요청은 interrupted 처리', () => {
  let state = prepared(); state = reduce(state, { type: 'draft', code }); state = reduce(state, { type: 'submit' });
  state = respond(state, 'question').state;
  state = reduce(state, { type: 'answerDraft', id: questionsOf(current(state))[0].id, answer: '아직 작성 중인 답변' });
  const pending = beginRequest(state, 'hint'); const restored = restore(serialize(pending.state));
  assert.equal(questionsOf(current(restored))[0].answerDraft, '아직 작성 중인 답변');
  assert.equal(questionsOf(current(restored))[0].answer, null);
  assert.equal(current(restored).requests.at(-1).status, 'interrupted');
  assert.equal(current(restored).stage, 'questions');
});
test('잘못된 JSON, 알 수 없는 설정, 크기/버전 오류를 원자적으로 거부한다', () => {
  const state = answered(), original = structuredClone(state);
  assert.throws(() => restore('{oops'));
  for (const mutate of [s => { s.settings.apiKey = 'not-a-real-key'; }, s => { s.schemaVersion = 999; }, s => { s.systemPrompt = 'override'; }, s => { s.sessions[0].questions[0].versionId = 'code-missing'; }, s => { s.profile.facts.minutes = '20'; }]) {
    const bad = structuredClone(state); mutate(bad); assert.throws(() => restore(JSON.stringify(bad)));
  }
  assert.throws(() => restore(' '.repeat(2_000_001))); assert.deepEqual(state, original);
});
test('실제 없는 줄/답변/인용문과 중복 평가 항목을 거부한다', () => {
  const state = answered('live'), context = makeContext(state), evaluation = realEvaluation(state);
  validateResponse('evaluate', evaluation, context);
  for (const mutate of [e => { e.criteria[0].evidence[0].startLine = 599; }, e => { e.criteria[0].evidence[0].quote = '없는 코드'; }, e => { e.criteria[0].evidence[1].reference = 'question-absent'; }, e => { e.criteria[0].name = e.criteria[1].name; }, e => { e.proposals[0].evidence = [e.proposals[0].evidence[0]]; }]) {
    const bad = structuredClone(evaluation); mutate(bad); assert.throws(() => validateResponse('evaluate', bad, context));
  }
});
test('답변 없는 이해도 평가, 중복 진행, 이미 반영한 결과 재적용을 제한한다', () => {
  const state = prepared(); assert.throws(() => beginRequest(state, 'evaluate'));
  const complete = answered(); const pending = beginRequest(complete, 'evaluate');
  assert.throws(() => beginRequest(pending.state, 'evaluate'));
  const data = demoResponse('evaluate', makeContext(pending.state));
  const next = applyResponse(pending.state, pending.requestId, data);
  assert.strictEqual(applyResponse(next, pending.requestId, data), next);
  assert.equal(current(next).evaluations.length, 1);
});
test('수정본 질문과 과거 답변을 혼합하지 않는다', () => {
  let state = respond(answered(), 'evaluate').state; const oldId = current(state).versionId;
  state = reduce(state, { type: 'revise' }); state = reduce(state, { type: 'draft', code: code + '// 설명 보완\n' }); state = reduce(state, { type: 'submit' });
  assert.notEqual(current(state).versionId, oldId); assert.equal(questionsOf(current(state)).length, 0);
  assert.equal(evaluationOf(current(state)), null); assert.throws(() => beginRequest(state, 'evaluate'));
});
test('조기 종료는 학습 완료로 간주하지 않으며 수준을 임의 갱신하지 않는다', () => {
  const state = reduce(prepared('live'), { type: 'close' });
  assert.equal(current(state).outcome.status, 'stopped'); assert.equal(state.changes.length, 0);
});
test('근거 있는 실제 평가만 종료 때 한 단계씩 갱신하고 사용자 사실은 유지한다', () => {
  let state = answered('live'); state = respond(state, 'evaluate', realEvaluation(state, '연습 중')).state;
  assert.ok(state.profile.estimates.concepts.every(c => c.level === '미평가'));
  state = reduce(state, { type: 'close' }); assert.equal(state.changes[0].after, '입문');
  assert.deepEqual(state.profile.facts, facts); assert.throws(() => reduce(state, { type: 'close' }));
});
test('단일 관찰의 독립 적용 제안과 미해결 정정 요청은 수준을 올리지 않는다', () => {
  let state = answered('live'); state = respond(state, 'evaluate', realEvaluation(state, '독립 적용')).state; state = reduce(state, { type: 'close' });
  assert.equal(state.changes[0].after, '미평가');
  let disputed = answered('live'); disputed = respond(disputed, 'evaluate', realEvaluation(disputed)).state;
  disputed = reduce(disputed, { type: 'correction', reason: '초기화 근거를 다시 확인해 주세요.' }); disputed = reduce(disputed, { type: 'close' });
  assert.equal(disputed.changes[0].after, '미평가');
});
test('목표 변경은 이전 평가를 보존하되 새 기준의 평가로 재사용하지 않는다', () => {
  let state = respond(answered(), 'evaluate').state; const old = taskOf(current(state)).id;
  state = reduce(state, { type: 'goal', goal: '포인터 교환 함수' });
  assert.equal(current(state).stage, 'goal'); assert.equal(current(state).taskId, null);
  assert.equal(current(state).goalHistory.length, 1); assert.equal(current(state).evaluations[0].taskId, old);
  assert.equal(evaluationOf(current(state)), null);
});
test('API 전송 맥락은 선택 개인정보를 제외하고 제출본/기준/미답변 질문을 유지한다', () => {
  const state = answered('live'), context = makeContext(state);
  assert.equal(Object.hasOwn(context.facts, 'education'), false);
  assert.equal(context.version.code, code); assert.ok(context.task.data.criteria.length);
  assert.equal(context.questions.length, 2); assert.ok(context.questions.every(q => q.answerDraft === ''));
});
test('새 세션에서 갱신한 수준을 재사용한다', () => {
  let state = answered('live'); state = respond(state, 'evaluate', realEvaluation(state)).state; state = reduce(state, { type: 'close' });
  state = reduce(state, { type: 'start', source: 'live' }); state = reduce(state, { type: 'goal', goal: '다음 배열 과제' });
  assert.equal(makeContext(state).estimates.concepts.find(c => c.name === '배열').level, '입문'); validateState(state);
});
