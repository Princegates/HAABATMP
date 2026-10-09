import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, validateQuestionShape } from '../dist/common/grading.js';
import { decideResult } from '../dist/common/result-rules.js';
import { certStatus } from '../dist/common/certificates.service.js';
import { addMonths, csvEscape, daysBetween } from '../dist/common/util.js';

const q = (type, answer, options = null, marks = 4) => ({ id: 'x', type, answer, options, marks });

test('grading: single choice, true/false', () => {
  assert.equal(grade(q('mcq_single', 2, ['a', 'b', 'c']), 2).marks, 4);
  assert.equal(grade(q('mcq_single', 2, ['a', 'b', 'c']), 1).marks, 0);
  assert.equal(grade(q('mcq_single', 2, ['a', 'b', 'c']), '2').marks, 0, 'a string is not an index');
  assert.equal(grade(q('true_false', true), true).marks, 4);
  assert.equal(grade(q('true_false', true), 'true').marks, 0);
});

test('grading: multiple choice gives partial credit but penalises guessing', () => {
  const m = q('mcq_multi', [0, 2], ['a', 'b', 'c', 'd']);
  assert.equal(grade(m, [0, 2]).marks, 4);
  assert.equal(grade(m, [0]).marks, 2);
  assert.equal(grade(m, [0, 1]).marks, 0, 'one right and one wrong cancels out');
  assert.equal(grade(m, [0, 1, 2, 3]).marks, 0, 'ticking everything must not pay');
  assert.equal(grade(m, 'nonsense').marks, 0);
});

test('grading: short answer ignores case and spacing; matching is per pair; essays wait for a marker', () => {
  assert.equal(grade(q('short_answer', ['Annex 17', 'annex seventeen']), '  ANNEX   17 ').marks, 4);
  assert.equal(grade(q('short_answer', ['Annex 17']), 'annex 14').marks, 0);
  const mt = q('matching', [1, 0, 2], { left: ['a', 'b', 'c'], right: ['x', 'y', 'z'] });
  assert.equal(grade(mt, [1, 0, 2]).marks, 4);
  assert.equal(Math.round(grade(mt, [1, 0, 0]).marks * 100) / 100, 2.67);
  assert.deepEqual(grade(q('essay', null), 'long answer'), { marks: 0, needsManual: true });
  assert.equal(grade(q('scenario', null), 'x').needsManual, true);
});

test('question authoring is validated by type', () => {
  assert.equal(validateQuestionShape('mcq_single', ['a', 'b'], 1), null);
  assert.ok(validateQuestionShape('mcq_single', ['a', 'b'], 5), 'answer outside the options');
  assert.ok(validateQuestionShape('mcq_single', ['only one'], 0), 'needs two options');
  assert.ok(validateQuestionShape('true_false', null, 'yes'));
  assert.ok(validateQuestionShape('matching', { left: ['a', 'b'], right: ['x'] }, [0, 0]), 'lists must be equal length');
  assert.equal(validateQuestionShape('essay', null, null), null);
});

const A = (best, attempts = 1, pass_mark = 70) => ({ best, attempts, pass_mark });
test('result rule: nothing is decided before the programme ends', () => {
  assert.equal(decideResult({ assessments: [A(95)], attendancePct: 100, minAttendancePct: 80, programmeEnded: false }).status, 'pending');
});
test('result rule: pass needs every assessment AND attendance', () => {
  const base = { minAttendancePct: 80, programmeEnded: true };
  assert.deepEqual(decideResult({ ...base, assessments: [A(90)], attendancePct: 100 }), { status: 'pass', score: 90 });
  assert.equal(decideResult({ ...base, assessments: [A(90)], attendancePct: 79.9 }).status, 'fail', 'attendance just under the minimum');
  assert.equal(decideResult({ ...base, assessments: [A(90)], attendancePct: 80 }).status, 'pass', 'exactly the minimum passes');
  assert.equal(decideResult({ ...base, assessments: [A(69.9)], attendancePct: 100 }).status, 'fail');
  assert.equal(decideResult({ ...base, assessments: [A(95), A(60)], attendancePct: 100 }).status, 'fail', 'one failed assessment fails the whole programme');
  assert.equal(decideResult({ ...base, assessments: [A(95, 1, 90), A(95, 1, 90)], attendancePct: 100 }).status, 'pass', 'each uses its own pass mark');
});
test('result rule: unmarked, missed and absent', () => {
  const base = { minAttendancePct: 80, programmeEnded: true };
  assert.equal(decideResult({ ...base, assessments: [A(null, 1)], attendancePct: 100 }).status, 'pending', 'sat it, waiting for the marker');
  assert.equal(decideResult({ ...base, assessments: [A(null, 0)], attendancePct: 100 }).status, 'fail', 'attended but never sat the exam');
  assert.equal(decideResult({ ...base, assessments: [A(null, 0)], attendancePct: 0 }).status, 'absent', 'never came, never sat');
  assert.equal(decideResult({ ...base, assessments: [], attendancePct: 100 }).status, 'pass', 'attendance-only course');
  assert.equal(decideResult({ ...base, assessments: [], attendancePct: null }).status, 'pending', 'no evidence at all');
});

test('certificate status is derived from dates, revocation wins', () => {
  const today = '2026-10-09';
  assert.equal(certStatus({ status: 'valid', expires_at: null }, 60, today), 'valid');
  assert.equal(certStatus({ status: 'valid', expires_at: '2027-10-09' }, 60, today), 'valid');
  assert.equal(certStatus({ status: 'valid', expires_at: '2026-12-01' }, 60, today), 'expiring_soon');
  assert.equal(certStatus({ status: 'valid', expires_at: '2026-12-08' }, 60, today), 'expiring_soon', 'exactly 60 days');
  assert.equal(certStatus({ status: 'valid', expires_at: '2026-12-09' }, 60, today), 'valid', '61 days is not yet soon');
  assert.equal(certStatus({ status: 'valid', expires_at: '2026-10-09' }, 60, today), 'expiring_soon', 'expires today is still valid');
  assert.equal(certStatus({ status: 'valid', expires_at: '2026-10-08' }, 60, today), 'expired');
  assert.equal(certStatus({ status: 'revoked', expires_at: '2030-01-01' }, 60, today), 'revoked');
});

test('dates and csv', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'month end does not roll into March');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-10-09', 24), '2028-10-09');
  assert.equal(daysBetween('2026-10-09', '2026-12-08'), 60);
  assert.equal(csvEscape('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'formula injection neutralised');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape(null), '');
});
