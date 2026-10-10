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

test('word import: reads every question type and ignores headings and notes', async () => {
  const { parseQuestionLines } = await import('../dist/common/question-import.js');
  const qs = parseQuestionLines([
    'My question paper', 'Please read the notes first.', '',
    '1. Which Annex covers security?', 'A. Annex 6', 'B. Annex 17', 'C. Annex 14', 'Answer: B', 'Marks: 2', 'Level: easy', 'Topic: AVSEC', '',
    '2. Choose the hazards', 'A) Birds', 'B) Fog', 'C) Chairs', 'Answer: A, B', '',
    '3. Airside speed limits apply to all vehicles.', 'Answer: True', '',
    '4. Name the document that records hazards.', 'Answer: hazard register | the hazard register', '',
    '5. Discuss the role of the SMS manager.', 'Type: Essay', 'Marks: 10',
  ]);
  assert.equal(qs.length, 5);
  assert.deepEqual(qs.map((q) => q.type), ['mcq_single', 'mcq_multi', 'true_false', 'short_answer', 'essay']);
  assert.equal(qs[0].answer, 1); assert.equal(qs[0].marks, 2); assert.equal(qs[0].topic, 'AVSEC');
  assert.deepEqual(qs[1].answer, [0, 1]); assert.equal(qs[2].answer, true);
  assert.deepEqual(qs[3].answer, ['hazard register', 'the hazard register']);
  assert.ok(qs.every((q) => q.problems.length === 0));
});

test('word import: a correct option can be marked with a star, and long lines wrap into the line before', async () => {
  const { parseQuestionLines } = await import('../dist/common/question-import.js');
  const [q] = parseQuestionLines(['1. The runway strip', 'must be kept clear of what?', 'A. Obstacles *', 'B. Grass', 'C. Markings that', 'continue over two lines']);
  assert.equal(q.prompt, 'The runway strip must be kept clear of what?');
  assert.equal(q.answer, 0); assert.equal(q.options[0], 'Obstacles'); assert.equal(q.options[2], 'Markings that continue over two lines');
});

test('word import: problems are reported per question, not guessed', async () => {
  const { parseQuestionLines } = await import('../dist/common/question-import.js');
  const qs = parseQuestionLines([
    '1. No answer given', 'A. One', 'B. Two', '',
    '2. Answer is not an option', 'A. One', 'B. Two', 'Answer: D', '',
    '3. Bad marks', 'A. One', 'B. Two', 'Answer: A', 'Marks: lots', '',
    '4. True or false?', 'Answer: Maybe', 'Type: True or False',
  ]);
  assert.equal(qs.length, 4);
  assert.match(qs[0].problems[0], /Mark the correct option/);
  assert.match(qs[1].problems[0], /does not match an option letter/);
  assert.ok(qs[2].problems.some((p) => /Marks/.test(p)));
  assert.ok(qs[3].problems.length >= 1);
});
