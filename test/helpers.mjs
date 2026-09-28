import { emptyState, reduce, beginRequest, applyResponse, makeContext, current, questionsOf, taskOf, versionOf, RUBRIC } from '../public/domain.mjs';
import { demoResponse } from '../lib/tutor.mjs';
export const facts = { education: '선택한 학력', experience: 'C 반복문을 배웠습니다.', purpose: '배열과 메모리를 이해하기', selfRating: '기초 문법 학습', explanationStyle: '작은 예시부터', minutes: 20 };
export const code = '#include <stdio.h>\nint max_value(const int a[], int n) {\n    int max = a[0];\n    for (int i = 1; i < n; ++i) {\n        if (a[i] > max) max = a[i];\n    }\n    return max;\n}\n';
export function respond(state, action, override) {
  const start = beginRequest(state, action);
  const data = override ?? demoResponse(action, makeContext(start.state));
  return { state: applyResponse(start.state, start.requestId, data), requestId: start.requestId, data };
}
export function prepared(source = 'demo') {
  let state = reduce(emptyState(), { type: 'profile', facts });
  state = reduce(state, { type: 'start', source });
  state = reduce(state, { type: 'goal', goal: '배열의 최댓값을 구하고 반복 경계를 설명하기' });
  state = respond(state, 'plan').state;
  return reduce(state, { type: 'confirm' });
}
export function answered(source = 'demo') {
  let state = prepared(source);
  state = reduce(state, { type: 'draft', code });
  state = reduce(state, { type: 'submit' });
  state = respond(state, 'question').state;
  for (const q of questionsOf(current(state))) state = reduce(state, { type: 'answer', id: q.id, answer: 'a[0]으로 초기화하고 i < n 동안 나머지 원소를 비교합니다. 원소 하나면 반복하지 않습니다.' });
  return state;
}
export function realEvaluation(state, level = '입문') {
  const s = current(state), v = versionOf(s), q = questionsOf(s)[0];
  const evidence = [{ kind: 'code', reference: v.id, startLine: 3, endLine: 3, quote: 'int max = a[0];' }, { kind: 'answer', reference: q.id, startLine: 0, endLine: 0, quote: 'a[0]으로 초기화' }];
  return { summary: '코드와 설명이 해당 요구사항에 부합하는 것으로 추정합니다.', criteria: RUBRIC.map(name => ({ name, verdict: '충족', reason: '코드와 답변에서 동일한 초기화 의도를 확인했습니다.', nextAction: '모든 원소가 음수인 입력도 추적하세요.', confidence: '중간', evidence })), limitations: ['코드를 실행하지 않았습니다.'], proposals: [{ concept: taskOf(s).data.concepts[0], level, reason: '초기화와 반복에 대해 코드 및 답변 근거가 있습니다.', evidence }], nextSteps: ['모든 원소가 음수일 때의 동작을 설명하세요.'] };
}
