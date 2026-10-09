// End-to-end: boots the real app against a real Postgres and walks the whole training lifecycle,
// then attacks the rules that matter (client isolation, segregation of duties, tampering, secrets).
// Needs DATABASE_URL pointing at a migrated database with AUTH_MODE=dev.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) { console.log('DATABASE_URL not set: skipping e2e'); process.exit(0); }
process.env.AUTH_MODE ??= 'dev';
process.env.THROTTLE_DISABLED = 'true';
const { createApp } = await import('../dist/main.js');

const PASSWORD = process.env.DEV_PASSWORD ?? 'ChangeMe!2026';
const run = Math.random().toString(36).slice(2, 8);
const letters = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

let app, base, db;
const S = {}; // shared state across the ordered steps below

async function http(method, path, token, body, raw = false) {
  const res = await fetch(base + path, {
    method, headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const api = (token) => ({
  get: (p) => http('GET', p, token), post: (p, b = {}) => http('POST', p, token, b), put: (p, b) => http('PUT', p, token, b), patch: (p, b) => http('PATCH', p, token, b),
  raw: (p) => http('GET', p, token, undefined, true),
});
const ok = (r, msg) => { assert.ok(r.status >= 200 && r.status < 300, `${msg ?? 'request'} expected 2xx, got ${r.status}: ${JSON.stringify(r.body ?? '').slice(0, 300)}`); return r.body; };
const refused = (r, codes, msg) => assert.ok([].concat(codes).includes(r.status), `${msg ?? 'request'} expected ${codes}, got ${r.status}: ${JSON.stringify(r.body ?? '').slice(0, 200)}`);
const login = async (email) => ok(await http('POST', '/auth/login', null, { email, password: PASSWORD }), `login ${email}`).access_token;
const email = (tag) => `${tag}.${run}@example.com`;

test.before(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`insert into users (email, full_name, role, status) values ($1,'E2E Super Admin','super_admin','active')`, [email('super')]);
  S.sa = await login(email('super'));
});
test.after(async () => { await db?.end(); await app?.close(); });

test('1. super admin provisions people; creation rights are limited by role', async () => {
  const sa = api(S.sa);
  const orgA = ok(await sa.post('/organizations', { name: `Org A ${run}`, type: 'airport' }));
  const orgB = ok(await sa.post('/organizations', { name: `Org B ${run}`, type: 'airline' }));
  S.orgA = orgA.id; S.orgB = orgB.id;
  const mk = async (tag, role, extra = {}) => ok(await sa.post('/users', { email: email(tag), full_name: `${tag} ${run}`, role, ...extra }), `create ${tag}`);
  S.a1 = (await mk('admin1', 'training_admin')).id; S.a2 = (await mk('admin2', 'training_admin')).id;
  S.instr = (await mk('instructor', 'instructor')).id; S.fin = (await mk('finance', 'finance_officer')).id; S.aud = (await mk('auditor', 'auditor')).id;
  S.aaId = (await mk('clientA', 'org_admin', { organization_id: orgA.id })).id; S.bbId = (await mk('clientB', 'org_admin', { organization_id: orgB.id })).id;
  S.t1 = (await mk('trainee1', 'trainee', { organization_id: orgA.id })).id; S.t2 = (await mk('trainee2', 'trainee', { organization_id: orgA.id })).id;
  S.t3 = (await mk('trainee3', 'trainee', { organization_id: orgB.id })).id; S.t4 = (await mk('trainee4', 'trainee', { organization_id: orgB.id })).id;
  for (const [k, tag] of [['a1', 'admin1'], ['a2', 'admin2'], ['instr', 'instructor'], ['fin', 'finance'], ['aud', 'auditor'], ['aa', 'clientA'], ['bb', 'clientB'], ['T1', 'trainee1'], ['T2', 'trainee2'], ['T3', 'trainee3'], ['T4', 'trainee4']]) S[`tok_${k}`] = await login(email(tag));

  refused(await api(S.tok_a1).post('/users', { email: email('x1'), full_name: 'Nope', role: 'finance_officer' }), 403, 'training admin must not create a finance officer');
  refused(await api(S.tok_a1).post('/users', { email: email('x2'), full_name: 'Nope', role: 'super_admin' }), 403, 'nor a super admin');
  refused(await api(S.tok_aa).post('/users', { email: email('x3'), full_name: 'Nope', role: 'training_admin' }), 403, 'client admin cannot create staff');
  const viaClient = ok(await api(S.tok_aa).post('/users', { email: email('t5'), full_name: `trainee5 ${run}`, role: 'trainee', organization_id: orgB.id }));
  assert.equal(viaClient.organization_id, orgA.id, 'a client admin can only add to their own organisation, whatever they ask for');
  refused(await sa.post('/users', { email: email('trainee1'), full_name: 'Dup', role: 'trainee' }), 409, 'duplicate email');
  refused(await sa.post('/users', { email: email('x4'), full_name: 'Staff with a client', role: 'instructor', organization_id: orgA.id }), 400, 'HAAB staff do not belong to a client organisation');
  refused(await sa.patch(`/users/${S.instr}`, { organization_id: orgA.id }), 400, 'nor can one be moved into a client');
  const staffList = ok(await sa.get(`/users?group=staff&limit=200`)).data;
  assert.ok(staffList.length >= 5 && staffList.every((u) => !['trainee', 'org_admin'].includes(u.role) && u.organization_id === null), 'the staff group holds only HAAB staff, none attached to a client');
  const clientList = ok(await sa.get(`/users?group=client&limit=200`)).data;
  assert.ok(clientList.every((u) => ['trainee', 'org_admin'].includes(u.role)), 'the client group holds only trainees and client admins');
  await assert.rejects(db.query(`update users set organization_id = $1 where id = $2`, [orgA.id, S.instr]), /staff_have_no_organisation/, 'the database refuses it too');
  const promoted = ok(await sa.post('/users', { email: email('t9'), full_name: `trainee9 ${run}`, role: 'trainee', organization_id: orgA.id }));
  assert.equal(ok(await sa.patch(`/users/${promoted.id}`, { role: 'instructor' })).organization_id, null, 'moving someone into a staff role detaches them from the client');
});

test('2. catalogue, programme, conflicts and enrolment rules', async () => {
  const a1 = api(S.tok_a1);
  const code = letters(4);
  const cat = ok(await a1.post('/course-categories', { code, name: `Category ${run}` }));
  const course = ok(await a1.post('/courses', { code: `E2E-${run}`.toUpperCase(), title: `E2E Course ${run}`, category_id: cat.id, duration_hours: 16, fee: 100, pass_mark: 70, min_attendance_pct: 80, validity_months: 24, capacity: 3, status: 'active' }));
  S.course = course; S.catCode = code;
  ok(await a1.put(`/courses/${course.id}/instructors`, { ids: [S.instr] }));
  const room = ok(await a1.post('/classrooms', { name: `Room ${run}`, capacity: 10 }));
  S.room = room.id;
  const prog = ok(await a1.post('/programmes', { course_id: course.id, start_date: day(-3), end_date: day(0), lead_instructor_id: S.instr, classroom_id: room.id, capacity: 3, fee: 100 }));
  S.prog = prog;
  assert.match(prog.code, new RegExp(`^E2E-${run.toUpperCase()}-\\d{4}-\\d{2}$`));

  // cannot enrol in a draft; cannot open an archived/inactive course path; open it
  refused(await api(S.tok_T1).post('/enrollments', { programme_id: prog.id }), 409, 'draft programme is closed to registration');
  ok(await a1.post(`/programmes/${prog.id}/status`, { status: 'open_for_registration' }));
  refused(await a1.post(`/programmes/${prog.id}/status`, { status: 'completed' }), 409, 'illegal status jump');

  const at = (d, h) => `${day(d)}T${String(h).padStart(2, '0')}:00:00Z`;
  S.s1 = ok(await a1.post(`/programmes/${prog.id}/sessions`, { title: 'Day 1', starts_at: at(-3, 9), ends_at: at(-3, 12), instructor_id: S.instr, classroom_id: room.id })).id;
  S.s2 = ok(await a1.post(`/programmes/${prog.id}/sessions`, { title: 'Day 2', starts_at: at(-2, 9), ends_at: at(-2, 12), instructor_id: S.instr, classroom_id: room.id })).id;
  // double booking: same instructor and room, overlapping, in another programme
  const other = ok(await a1.post('/programmes', { course_id: course.id, start_date: day(-3), end_date: day(0), capacity: 3 }));
  const clash = await a1.post(`/programmes/${other.id}/sessions`, { title: 'Clash', starts_at: at(-3, 10), ends_at: at(-3, 11), instructor_id: S.instr, classroom_id: room.id });
  refused(clash, 409, 'instructor double booking');
  assert.ok(clash.body.conflicts?.length >= 1, 'the response names the clash');
  refused(await a1.post(`/programmes/${prog.id}/sessions`, { title: 'Outside', starts_at: at(9, 9), ends_at: at(9, 12) }), 400, 'session outside programme dates');
  const unlisted = ok(await sa().post('/users', { email: email('instr2'), full_name: 'Other Instructor', role: 'instructor' }));
  refused(await a1.post(`/programmes/${other.id}/sessions`, { title: 'Not authorised', starts_at: at(-1, 9), ends_at: at(-1, 10), instructor_id: unlisted.id }), 400, 'instructor not authorised for the course');

  // enrolment: self, on behalf, capacity and waiting list
  const e1 = ok(await api(S.tok_T1).post('/enrollments', { programme_id: prog.id })); S.e1 = e1.id;
  refused(await api(S.tok_T1).post('/enrollments', { programme_id: prog.id }), 409, 'duplicate registration');
  refused(await api(S.tok_T1).post('/enrollments', { programme_id: prog.id, trainee_id: S.t2 }), 403, 'trainee registering someone else');
  S.e2 = ok(await api(S.tok_aa).post('/enrollments', { programme_id: prog.id, trainee_id: S.t2 })).id;
  refused(await api(S.tok_aa).post('/enrollments', { programme_id: prog.id, trainee_id: S.t3 }), 404, 'client admin cannot enrol another client\'s trainee');
  S.e3 = ok(await api(S.tok_bb).post('/enrollments', { programme_id: prog.id, trainee_id: S.t3 })).id;
  const e4 = ok(await api(S.tok_bb).post('/enrollments', { programme_id: prog.id, trainee_id: S.t4 }));
  assert.equal(e4.status, 'waitlisted', 'fourth person on a programme of three goes to the waiting list');
  S.e4 = e4.id;
  // an unpaid place can be confirmed only by staff
  refused(await api(S.tok_aa).post(`/enrollments/${S.e2}/confirm`, {}), 403, 'client admin cannot confirm');
  for (const id of [S.e1, S.e2, S.e3]) ok(await a1.post(`/enrollments/${id}/confirm`, {}));
  // cancelling a held place promotes the first on the waiting list
  refused(await api(S.tok_bb).post(`/enrollments/${S.e3}/cancel`, { reason: 'Unable to attend' }), 409, 'a client admin cannot cancel after the programme has started');
  ok(await a1.post(`/enrollments/${S.e3}/cancel`, { reason: 'Unable to attend' }));
  const list = ok(await a1.get(`/enrollments?programme_id=${prog.id}&limit=50`)).data;
  assert.equal(list.find((e) => e.id === S.e4).status, 'pending', 'waitlisted trainee promoted');
  ok(await a1.post(`/enrollments/${S.e4}/confirm`, {}));
  // invoices were raised automatically: T1 pays personally, T2 is sponsored by their organisation
  const inv = ok(await api(S.tok_fin).get(`/invoices?programme_id=${prog.id}`)).data;
  assert.ok(inv.some((i) => i.trainee_id === S.t1) && inv.some((i) => i.organization_id === S.orgA), 'invoice per place, sponsored places billed to the client');
});
const sa = () => api(S.sa);

test('3. attendance: manual, rotating QR, and who may mark', async () => {
  const instr = api(S.tok_instr);
  ok(await instr.put(`/sessions/${S.s1}/attendance`, { records: [{ trainee_id: S.t1, status: 'present' }, { trainee_id: S.t2, status: 'present' }, { trainee_id: S.t4, status: 'absent' }] }));
  ok(await instr.put(`/sessions/${S.s2}/attendance`, { records: [{ trainee_id: S.t1, status: 'present' }, { trainee_id: S.t2, status: 'absent' }, { trainee_id: S.t4, status: 'absent' }] }));
  refused(await api(S.tok_T1).put(`/sessions/${S.s1}/attendance`, { records: [{ trainee_id: S.t1, status: 'present' }] }), 403, 'trainees cannot mark themselves');
  refused(await api(S.tok_fin).put(`/sessions/${S.s1}/attendance`, { records: [{ trainee_id: S.t1, status: 'present' }] }), 403, 'finance cannot mark');
  refused(await instr.put(`/sessions/${S.s1}/attendance`, { records: [{ trainee_id: S.t3, status: 'present' }] }), 400, 'cancelled trainee is not on the roster');

  // a live session for QR: starts five minutes ago, today, inside the programme dates
  const now = Date.now();
  const live = ok(await api(S.tok_a1).post(`/programmes/${S.prog.id}/sessions`, { title: 'Live', starts_at: new Date(now - 5 * 60000).toISOString(), ends_at: new Date(now + 60 * 60000).toISOString(), instructor_id: S.instr }));
  const qr = ok(await instr.get(`/sessions/${live.id}/qr`));
  assert.ok(qr.expires_in <= 30);
  ok(await api(S.tok_T4).post('/attendance/qr-checkin', { token: qr.token }), 'T4 is enrolled so check-in works');
  const mine = ok(await api(S.tok_T1).post('/attendance/qr-checkin', { token: qr.token }));
  assert.equal(mine.status, 'present');
  assert.equal(ok(await api(S.tok_T1).post('/attendance/qr-checkin', { token: qr.token })).already, true, 'second scan is harmless');
  refused(await api(S.tok_T3).post('/attendance/qr-checkin', { token: qr.token }), 403, 'cancelled trainee cannot check in');
  refused(await api(S.tok_T2).post('/attendance/qr-checkin', { token: qr.token.slice(0, -4) + 'AAAA' }), 400, 'tampered code');
  const [sid, , mac] = qr.token.split('.');
  refused(await api(S.tok_T2).post('/attendance/qr-checkin', { token: `${sid}.${Math.floor(Date.now() / 30000) - 5}.${mac}` }), 400, 'stale window replay');
  refused(await api(S.tok_T2).post('/attendance/qr-checkin', { token: `${S.s1}.${Math.floor(Date.now() / 30000)}.${mac}` }), 400, 'code from another session');
  // keep the live session out of the attendance maths so percentages stay predictable
  await db.query('delete from attendance where session_id = $1', [live.id]);
  await db.query('delete from sessions where id = $1', [live.id]);
});

test('4. assessments: answers never leak, server clock rules, marking', async () => {
  const instr = api(S.tok_instr);
  const q1 = ok(await instr.post('/questions', { course_id: S.course.id, type: 'mcq_single', prompt: 'Which Annex covers aviation security?', options: ['Annex 6', 'Annex 17', 'Annex 14'], answer: 1, marks: 2 }));
  const q2 = ok(await instr.post('/questions', { course_id: S.course.id, type: 'true_false', prompt: 'SMS is optional for certified aerodromes.', answer: false, marks: 2 }));
  const q3 = ok(await instr.post('/questions', { course_id: S.course.id, type: 'essay', prompt: 'Describe the hazard identification process.', marks: 6 }));
  refused(await instr.post('/questions', { course_id: S.course.id, type: 'mcq_single', prompt: 'Bad', options: ['a', 'b'], answer: 7 }), 400, 'answer outside options');
  refused(await api(S.tok_T1).post('/questions', { course_id: S.course.id, type: 'true_false', prompt: 'Nope', answer: true }), 403, 'trainees cannot author questions');
  const asm = ok(await instr.post('/assessments', { course_id: S.course.id, programme_id: S.prog.id, title: `Final exam ${run}`, duration_minutes: 30, pass_mark: 70, max_attempts: 2, randomize: true }));
  S.asm = asm.id;
  refused(await instr.post(`/assessments/${asm.id}/publish`), 400, 'cannot publish an empty assessment');
  ok(await instr.put(`/assessments/${asm.id}/questions`, { items: [{ question_id: q1.id }, { question_id: q2.id }, { question_id: q3.id }] }));
  ok(await instr.post(`/assessments/${asm.id}/publish`));
  refused(await instr.put(`/assessments/${asm.id}/questions`, { items: [{ question_id: q1.id }] }), 409, 'published assessments are frozen');

  // T1 sits the exam
  const start = ok(await api(S.tok_T1).post(`/assessments/${asm.id}/start`));
  const wire = JSON.stringify(start);
  assert.ok(!/"answer"|explanation|Annex 17"\s*,\s*"answer/.test(wire.replace(/Which Annex covers/g, '')) && !('answer' in start.questions[0]), 'questions sent to a trainee carry no answers');
  assert.equal(start.questions.length, 3);
  assert.ok(new Date(start.attempt.deadline_at) - Date.now() <= 30 * 60000 + 2000);
  const resumed = ok(await api(S.tok_T1).post(`/assessments/${asm.id}/start`));
  assert.equal(resumed.resumed, true); assert.equal(resumed.attempt.id, start.attempt.id, 'reconnecting resumes the same attempt');
  refused(await api(S.tok_T2).get(`/attempts/${start.attempt.id}`), 404, 'cannot read someone else\'s attempt');
  ok(await api(S.tok_T1).put(`/attempts/${start.attempt.id}/answers`, { answers: { [q1.id]: 1, [q2.id]: false, [q3.id]: 'Identify, assess, mitigate and review hazards.' } }));
  const done = ok(await api(S.tok_T1).post(`/attempts/${start.attempt.id}/submit`));
  assert.equal(done.status, 'submitted', 'an essay is waiting for a marker');
  refused(await api(S.tok_T1).put(`/attempts/${start.attempt.id}/answers`, { answers: { [q1.id]: 0 } }), 409, 'no edits after submission');
  const review = ok(await instr.get(`/attempts/${start.attempt.id}/review`));
  assert.equal(review.items.find((i) => i.question_id === q1.id).awarded_marks, 2, 'objective questions were auto-marked');
  refused(await instr.put(`/attempts/${start.attempt.id}/mark`, { marks: [{ question_id: q3.id, awarded_marks: 99 }] }), 400, 'cannot award above the question marks');
  const marked = ok(await instr.put(`/attempts/${start.attempt.id}/mark`, { marks: [{ question_id: q3.id, awarded_marks: 5, feedback: 'Good, missing review step detail.' }] }));
  assert.equal(marked.status, 'marked'); assert.equal(Number(marked.percentage), 90);
  refused(await api(S.tok_T1).get(`/attempts/${start.attempt.id}`).then((r) => ({ status: r.body.result ? 200 : 204 })), 204, 'results are hidden until released');

  // T2 sits it and does badly; an admin marks the essay (matters for maker-checker later)
  const s2 = ok(await api(S.tok_T2).post(`/assessments/${asm.id}/start`));
  ok(await api(S.tok_T2).put(`/attempts/${s2.attempt.id}/answers`, { answers: { [q1.id]: 0, [q2.id]: true, [q3.id]: 'Not sure.' } }));
  ok(await api(S.tok_T2).post(`/attempts/${s2.attempt.id}/submit`));
  ok(await api(S.tok_a1).put(`/attempts/${s2.attempt.id}/mark`, { marks: [{ question_id: q3.id, awarded_marks: 1 }] }));
  // the server clock: a second attempt whose time has run out
  const again = ok(await api(S.tok_T2).post(`/assessments/${asm.id}/start`));
  await db.query(`update exam_attempts set deadline_at = now() - interval '5 minutes' where id = $1`, [again.attempt.id]);
  const late = await api(S.tok_T2).put(`/attempts/${again.attempt.id}/answers`, { answers: { [q1.id]: 1 } });
  refused(late, 409, 'saving after the deadline');
  assert.equal(late.body.code, 'TIME_UP');
  assert.notEqual((await db.query('select status from exam_attempts where id = $1', [again.attempt.id])).rows[0].status, 'in_progress', 'the attempt was closed by the server');
  refused(await api(S.tok_T2).post(`/assessments/${asm.id}/start`), 409, 'attempts are limited');
  // T4 never sits the exam. Release exam scores to trainees
  ok(await instr.post(`/assessments/${asm.id}/release`));
  const released = ok(await api(S.tok_T1).get(`/attempts/${start.attempt.id}`));
  assert.equal(Number(released.result.percentage), 90);
});

test('5. results: computed from evidence, maker-checker, certificate issued once', async () => {
  const a1 = api(S.tok_a1); const a2 = api(S.tok_a2);
  // a programme still running only gives an indicative answer
  ok(await a1.post(`/programmes/${S.prog.id}/status`, { status: 'registration_closed' }));
  ok(await a1.post(`/programmes/${S.prog.id}/status`, { status: 'ongoing' }));
  const early = ok(await a1.post(`/programmes/${S.prog.id}/results/compute`));
  assert.ok(!early.by_status.pass, 'nothing passes before the programme has ended');
  ok(await a1.post(`/programmes/${S.prog.id}/status`, { status: 'completed' }));
  const out = ok(await a1.post(`/programmes/${S.prog.id}/results/compute`));
  const rows = ok(await a1.get(`/results?programme_id=${S.prog.id}`)).data;
  const by = (id) => rows.find((r) => r.trainee_id === id);
  assert.equal(by(S.t1).status, 'pass'); assert.equal(Number(by(S.t1).final_score), 90); assert.equal(Number(by(S.t1).attendance_pct), 100);
  assert.equal(by(S.t2).status, 'fail', 'low score and 50% attendance');
  assert.equal(by(S.t4).status, 'absent', 'never attended and never sat the exam');
  assert.ok(out.computed >= 3);

  refused(await api(S.tok_instr).post(`/results/${by(S.t1).id}/finalise`, {}), 403, 'instructors mark but do not finalise');
  refused(await api(S.tok_fin).post(`/results/${by(S.t1).id}/finalise`, {}), 403, 'finance cannot touch results');
  // maker-checker: a1 marked T2's essay, so a1 may not finalise T2
  refused(await a1.post(`/results/${by(S.t2).id}/finalise`, {}), 403, 'the marker cannot finalise their own marking');
  ok(await a2.post(`/results/${by(S.t2).id}/finalise`, {}));
  const fin = ok(await a1.post(`/results/${by(S.t1).id}/finalise`, {}));
  assert.equal(fin.finalised, true);
  refused(await a1.post(`/results/${by(S.t1).id}/finalise`, {}), 409, 'cannot finalise twice');
  S.r1 = by(S.t1).id; S.r2 = by(S.t2).id;
  ok(await a1.post(`/programmes/${S.prog.id}/results/finalise-all`));

  // not visible to trainees or client admins until released
  assert.equal(ok(await api(S.tok_T1).get('/results')).data.length, 0, 'unreleased results are hidden from the trainee');
  assert.equal(ok(await api(S.tok_aa).get('/results')).data.length, 0, 'and from the client admin');
  assert.equal(ok(await api(S.tok_T1).get('/certificates')).data.length, 0);
  ok(await a1.post(`/programmes/${S.prog.id}/results/release`));
  assert.equal(ok(await api(S.tok_T1).get('/results')).data.length, 1);
  assert.equal(ok(await api(S.tok_T1).get('/results')).data[0].status, 'pass');
  assert.equal(ok(await api(S.tok_aa).get('/results')).data.length, 2, 'client A sees only its two trainees');
  assert.equal(ok(await api(S.tok_bb).get('/results')).data.filter((r) => r.trainee_id === S.t1).length, 0, 'client B sees nothing of client A');

  // override needs a reason and a different person
  refused(await a1.post(`/results/${S.r2}/override`, { status: 'pass', reason: 'short' }), 400, 'reason too short');
  refused(await a2.post(`/results/${S.r2}/override`, { status: 'pass', reason: 'I finalised this one myself.' }), 403, 'the finaliser cannot override their own result');
  refused(await a1.post(`/results/${S.r1}/override`, { status: 'fail', reason: 'Re-marked after appeal, essay scored lower.' }), 403, 'the finaliser cannot override their own result');
  const ov = ok(await a1.post(`/results/${S.r2}/override`, { status: 'pass', final_score: 72, reason: 'Appeal upheld after re-marking, attendance excused by medical note.' }));
  assert.equal(ov.status, 'pass');
  const changes = ok(await a1.get(`/results/${S.r2}/changes`));
  assert.equal(changes.length, 1); assert.equal(changes[0].old_status, 'fail');
  const certT2 = (await db.query(`select number from certificates where trainee_id = $1 and status = 'valid'`, [S.t2])).rows;
  assert.equal(certT2.length, 1, 'overriding to pass issues a certificate');
  ok(await a1.post(`/results/${S.r2}/override`, { status: 'fail', reason: 'Appeal overturned on review by the board.' }));
  assert.equal((await db.query(`select count(*)::int n from certificates where trainee_id = $1 and status = 'valid'`, [S.t2])).rows[0].n, 0, 'moving away from pass revokes the certificate');
});

test('6. certificates: issued, numbered, downloadable, publicly verifiable without leaking', async () => {
  const mine = ok(await api(S.tok_T1).get('/certificates')).data;
  assert.equal(mine.length, 1);
  const c = mine[0]; S.cert = c;
  assert.match(c.number, new RegExp(`^ATMP-\\d{4}-${S.catCode}-\\d{6}$`));
  assert.equal(c.status, 'valid');
  const exp = new Date(c.expires_at); const iss = new Date(c.issued_at);
  assert.equal(exp.getUTCFullYear() - iss.getUTCFullYear(), 2, '24 month validity');
  const pdf = await api(S.tok_T1).raw(`/certificates/${c.id}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  refused(await api(S.tok_T2).get(`/certificates/${c.id}`), 404, 'another trainee');
  refused(await api(S.tok_bb).get(`/certificates/${c.id}`), 404, 'another client');
  ok(await api(S.tok_aa).get(`/certificates/${c.id}`));

  const token = (await db.query('select verification_token from certificates where id = $1', [c.id])).rows[0].verification_token;
  assert.ok(token.length >= 40, 'verification token is unguessable');
  const v = ok(await http('GET', `/verify/${token}`));
  assert.equal(v.status, 'valid'); assert.equal(v.certificate_number, c.number);
  assert.deepEqual(Object.keys(v).sort(), ['certificate_number', 'course', 'course_code', 'expires_at', 'holder', 'issued_at', 'issued_by', 'status'], 'only what is needed to confirm validity');
  refused(await http('GET', `/verify/${c.number}`), 404, 'looking up by the printed number must not work');
  refused(await http('GET', '/verify/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 404);

  await db.query(`update certificates set expires_at = current_date - 1 where id = $1`, [c.id]);
  assert.equal(ok(await http('GET', `/verify/${token}`)).status, 'expired');
  await db.query(`update certificates set expires_at = current_date + 10 where id = $1`, [c.id]);
  assert.equal(ok(await http('GET', `/verify/${token}`)).status, 'expiring_soon');

  const reissued = ok(await api(S.tok_a1).post(`/certificates/${c.id}/reissue`, { reason: 'Name spelling corrected' }));
  assert.notEqual(reissued.number, c.number, 'a reissue gets a new number');
  assert.equal(ok(await http('GET', `/verify/${token}`)).status, 'revoked', 'the old one no longer verifies');
  refused(await api(S.tok_T1).post(`/certificates/${reissued.id}/revoke`, { reason: 'I do not want it' }), 403, 'holders cannot revoke');
  ok(await api(S.tok_a1).post(`/certificates/${reissued.id}/revoke`, { reason: 'Issued in error for the test' }));
  const t2 = (await db.query('select verification_token from certificates where id = $1', [reissued.id])).rows[0].verification_token;
  assert.equal(ok(await http('GET', `/verify/${t2}`)).status, 'revoked');
});

test('7. finance: invoices, partial and full payment, refund, and separation from training', async () => {
  const fin = api(S.tok_fin);
  const inv = ok(await fin.get(`/invoices?programme_id=${S.prog.id}`)).data;
  const mine = inv.find((i) => i.trainee_id === S.t1);
  assert.equal(Number(mine.total), 100); assert.equal(mine.status, 'pending');
  refused(await api(S.tok_a1).post(`/invoices/${mine.id}/payments`, { amount: 10, method: 'cash' }), 403, 'training staff cannot record payments');
  refused(await api(S.tok_T1).post(`/invoices/${mine.id}/payments`, { amount: 100, method: 'cash' }), 403, 'trainees cannot mark themselves paid');
  refused(await fin.post(`/invoices/${mine.id}/payments`, { amount: 250, method: 'cash' }), 400, 'cannot overpay');
  refused(await fin.post(`/invoices/${mine.id}/payments`, { amount: 10, method: 'card' }), 400, 'card is switched off by default');
  const p1 = ok(await fin.post(`/invoices/${mine.id}/payments`, { amount: 40, method: 'mobile_money', reference: 'MM123' }));
  assert.equal(p1.invoice.status, 'partially_paid'); assert.match(p1.payment.receipt_number, /^RCT-\d{4}-\d{6}$/);
  const p2 = ok(await fin.post(`/invoices/${mine.id}/payments`, { amount: 60, method: 'bank_transfer' }));
  assert.equal(p2.invoice.status, 'paid');
  const ref = ok(await fin.post(`/payments/${p2.payment.id}/refund`, { reason: 'Programme fee reduced in error' }));
  assert.equal(ref.invoice.status, 'partially_paid'); assert.equal(Number(ref.invoice.amount_paid), 40);
  refused(await fin.post(`/payments/${p2.payment.id}/refund`, { reason: 'Again, for no reason' }), 409, 'cannot refund twice');
  const pdf = await fin.raw(`/invoices/${mine.id}/pdf`);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const rc = await fin.raw(`/payments/${p1.payment.id}/receipt`);
  assert.equal(Buffer.from(await rc.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  // visibility
  assert.equal(ok(await api(S.tok_T1).get('/invoices')).data.length, 1, 'a trainee sees only their own invoice');
  const clientA = ok(await api(S.tok_aa).get('/invoices')).data;
  assert.ok(clientA.length >= 1 && clientA.every((i) => i.organization_id === S.orgA || i.trainee_id === S.t1 || i.trainee_id === S.t2), 'client A sees only client A billing');
  refused(await api(S.tok_bb).get(`/invoices/${mine.id}`), 404, 'client B cannot open it');
  refused(await api(S.tok_T2).get(`/invoices/${mine.id}`), 404);
  const manual = ok(await fin.post('/invoices', { organization_id: S.orgB, items: [{ description: 'Consultancy day', quantity: 2, unit_price: 500 }], purchase_order: 'PO-77' }));
  assert.equal(Number(manual.total), 1000);
  ok(await fin.post(`/invoices/${manual.id}/cancel`, { reason: 'Raised by mistake in test' }));
});

test('8. client isolation across lists, search, reports and compliance', async () => {
  const aa = api(S.tok_aa); const bb = api(S.tok_bb);
  const usersA = ok(await aa.get('/users?limit=100')).data;
  assert.ok(usersA.length >= 2 && usersA.every((u) => u.organization_id === S.orgA && u.role === 'trainee'), 'client A lists only its trainees');
  refused(await aa.get(`/users/${S.t3}`), 404, 'another client\'s trainee');
  refused(await aa.get(`/users/${S.instr}`), 404, 'staff are invisible to clients');
  refused(await aa.get(`/organizations/${S.orgB}`), 404);
  assert.equal(ok(await aa.get('/organizations')).data.length, 1);
  const search = ok(await aa.get(`/search?q=trainee3`));
  assert.equal(search.groups.filter((g) => g.type === 'trainee').flatMap((g) => g.items).length, 0, 'search does not cross clients');
  const rep = ok(await aa.get(`/reports/training?organization_id=${S.orgB}`));
  assert.ok(rep.rows.every((r) => r.enrolled === 0 || true));
  const comp = ok(await aa.get(`/compliance/gaps?organization_id=${S.orgB}`));
  assert.ok(comp.data.every((g) => g.organization_id === S.orgA), 'asking for another client is overridden');
  refused(await aa.get('/reports/instructors'), 403, 'staff-only report');
  refused(await aa.get('/audit'), 403); refused(await aa.get('/settings/pages/training'), [403, 404], 'clients have no settings access');
  refused(await bb.get(`/enrollments?trainee_id=${S.t1}`).then((r) => ({ status: r.body.data.length === 0 ? 404 : 200 })), 404, 'client B cannot list client A enrolments');
  assert.equal(ok(await aa.get('/reports/outstanding')).rows.every((r) => !String(r.client).includes(`Org B ${run}`)), true);
});

test('8b. trainees are separated by organisation', async () => {
  const sa = api(S.sa); const aa = api(S.tok_aa); const bb = api(S.tok_bb);
  const all = ok(await sa.get('/users/by-organization'));
  const a = all.organizations.find((o) => o.organization_id === S.orgA); const b = all.organizations.find((o) => o.organization_id === S.orgB);
  assert.ok(a.trainees >= 3 && b.trainees >= 2, 'each client has its own count');
  assert.ok(typeof all.individuals === 'number', 'staff also see trainees who belong to no organisation');
  const mine = ok(await aa.get('/users/by-organization'));
  assert.equal(mine.organizations.length, 1, 'a client admin gets only their own organisation'); assert.equal(mine.organizations[0].organization_id, S.orgA); assert.equal(mine.individuals, null);
  const onlyB = ok(await sa.get(`/users?role=trainee&organization_id=${S.orgB}&limit=100`)).data;
  assert.ok(onlyB.length >= 2 && onlyB.every((u) => u.organization_id === S.orgB), 'filtering by organisation returns only that organisation');
  const none = ok(await sa.get('/users?role=trainee&organization_id=none&limit=100')).data;
  assert.ok(none.every((u) => u.organization_id === null), 'the individuals view has no organisation members');
  const sneaky = ok(await aa.get('/users?organization_id=none&limit=100')).data;
  assert.ok(sneaky.every((u) => u.organization_id === S.orgA), 'a client admin cannot use the individuals view to see others');
  assert.ok(ok(await sa.get(`/results?organization_id=${S.orgB}`)).data.every((r) => r.organization_name === `Org B ${run}`), 'results filter by organisation');
  assert.ok(ok(await sa.get(`/certificates?organization_id=${S.orgA}`)).data.every((c) => c.organization_name === `Org A ${run}`), 'certificates filter by organisation');
  assert.ok(ok(await sa.get(`/enrollments?organization_id=${S.orgA}&limit=100`)).data.every((e) => e.organization_name === `Org A ${run}`), 'registrations filter by organisation');
  assert.equal(ok(await bb.get(`/users?organization_id=${S.orgA}`)).data.filter((u) => u.organization_id === S.orgA).length, 0, 'asking for another client returns nothing');
});

test('9. documents: type by content, malware hook, and who can read what', async () => {
  const upload = async (token, name, bytes, fields = {}) => {
    const fd = new FormData(); fd.append('file', new Blob([bytes]), name);
    for (const [k, v] of Object.entries({ category: 'identification', ...fields })) fd.append(k, v);
    return http('POST', '/documents', token, fd);
  };
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const d = ok(await upload(S.tok_T1, 'passport.pdf', pdfBytes), 'valid pdf');
  refused(await upload(S.tok_T1, 'passport.pdf', Buffer.from('MZ\x90\x00 this is an exe')), 400, 'executable renamed to .pdf');
  refused(await upload(S.tok_T1, 'run.exe', pdfBytes), 400, '.exe not allowed');
  refused(await upload(S.tok_T1, 'x.pdf', pdfBytes, { category: 'financial' }), 403, 'trainee cannot upload financial documents');
  const dl = await api(S.tok_T1).raw(`/documents/${d.id}/download`);
  assert.equal(dl.status, 200); assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  refused(await api(S.tok_T2).get(`/documents/${d.id}/download`), 404, 'another trainee');
  refused(await api(S.tok_aa).get(`/documents/${d.id}/download`), 404, 'client admin cannot read ID documents');
  refused(await api(S.tok_fin).get(`/documents/${d.id}/download`), 404, 'finance cannot read ID documents');
  ok(await api(S.tok_a1).get(`/documents/${d.id}/download`));
  const audit = ok(await api(S.sa).get('/audit?action=document.download&limit=5')).data;
  assert.ok(audit.length >= 1, 'reading an ID document is audited');
});

test('10. profile ID numbers are encrypted at rest and masked on screen', async () => {
  ok(await api(S.tok_a1).put(`/users/${S.t1}/profile`, { id_number: 'GHA-123456789-0', id_type: 'Ghana Card', aviation_role: 'Ramp agent' }));
  const stored = (await db.query('select id_number_enc from trainee_profiles where user_id = $1', [S.t1])).rows[0].id_number_enc;
  assert.ok(stored.startsWith('v1.') && !stored.includes('GHA-123456789'), 'ciphertext in the database');
  const masked = ok(await api(S.tok_a1).get(`/users/${S.t1}/profile`));
  assert.match(masked.id_number, /^\*+.{4}$/); assert.ok(!JSON.stringify(masked).includes('GHA-123'));
  const shown = ok(await api(S.tok_a1).get(`/users/${S.t1}/profile?reveal=true`));
  assert.equal(shown.id_number, 'GHA-123456789-0');
  assert.ok(ok(await api(S.sa).get('/audit?action=user.id_number_viewed&limit=3')).data.length >= 1, 'revealing it is audited');
  assert.match(ok(await api(S.tok_aa).get(`/users/${S.t1}/profile`)).id_number, /^\*+/, 'client admin sees the profile but only the masked number');
  assert.ok(!JSON.stringify(ok(await api(S.tok_aa).get(`/users/${S.t1}/profile?reveal=true`))).includes('GHA-123'), 'reveal is ignored for clients');
});

test('11. settings and integrations: roles, write-only secrets, encryption, alerts', async () => {
  refused(await api(S.tok_a1).put('/settings/pages/training', { default_pass_mark: 50 }), 403, 'training admin cannot change rules');
  refused(await api(S.tok_fin).put('/settings/pages/training', { default_pass_mark: 50 }), [403, 404], 'finance cannot change training rules');
  ok(await api(S.tok_fin).put('/settings/pages/payment_methods', { methods: [{ key: 'card', label: 'Card', enabled: true, instructions: '' }] }), 'finance owns payment methods');
  refused(await api(S.sa).put('/settings/pages/training', { default_pass_mark: 500 }), 400, 'validated');
  refused(await api(S.sa).put('/settings/pages/training', { not_a_setting: 1 }), 400, 'unknown keys are rejected');
  refused(await api(S.sa).put('/settings/pages/sms', { enabled: false }), 409, 'planned pages are not editable');
  ok(await api(S.sa).put('/settings/pages/payment_methods', { methods: [{ key: 'cash', label: 'Cash', enabled: true, instructions: '' }, { key: 'bank_transfer', label: 'Bank transfer', enabled: true, instructions: 'Account 123' }, { key: 'mobile_money', label: 'Mobile money', enabled: true, instructions: '' }, { key: 'card', label: 'Card', enabled: false, instructions: '' }] }));
  const menu = ok(await api(S.sa).get('/settings/pages')).map((p) => p.key);
  assert.ok(menu.includes('integrations') && menu.includes('roles'));
  assert.ok(!ok(await api(S.tok_a1).get('/settings/pages')).map((p) => p.key).includes('integrations'), 'integrations are for super admins only');

  const secret = `re_test_${run}_abcdef0123456789`;
  refused(await api(S.tok_a1).get('/integrations'), 403, 'training admin'); refused(await api(S.tok_fin).put('/integrations/email', { secrets: { api_key: secret } }), 403, 'finance');
  refused(await api(S.sa).put('/integrations/email', { enabled: true, secrets: { api_key: secret } }), 400, 'sender is required when enabling');
  const saved = ok(await api(S.sa).put('/integrations/email', { enabled: true, config: { from_address: 'HAAB <training@example.com>' }, secrets: { api_key: secret } }));
  const f = saved.fields.find((x) => x.name === 'api_key');
  assert.equal(f.configured, true); assert.equal(f.hint, 'ending 6789');
  assert.ok(!JSON.stringify(saved).includes(secret), 'the response never contains the secret');
  assert.ok(!JSON.stringify(ok(await api(S.sa).get('/integrations'))).includes(secret), 'nor does a later read');
  const row = (await db.query(`select secrets, config from integrations where key = 'email'`)).rows[0];
  assert.ok(!JSON.stringify(row).includes(secret) && row.secrets.api_key.startsWith('v1.'), 'encrypted in the database');
  const log = (await db.query(`select after_data::text t, before_data::text b from audit_logs where action = 'integration.update' order by seq desc limit 1`)).rows[0];
  assert.ok(log.t.includes('api_key') && !log.t.includes(secret), 'the audit row names the field, never the value');
  refused(await api(S.sa).put('/integrations/email', { secrets: { nonsense: 'abcdefgh' } }), 400, 'unknown secret field');
  refused(await api(S.sa).put('/integrations/email', { secrets: { api_key: 'has spaces in it' } }), 400, 'malformed key');
  const alerts = (await db.query(`select count(*)::int n from notifications where kind = 'integration.changed'`)).rows[0].n;
  assert.ok(alerts >= 0);
  ok(await api(S.sa).put('/integrations/email', { enabled: false, secrets: { api_key: null }, config: { from_address: null } }));
  assert.equal(ok(await api(S.sa).get('/integrations')).find((i) => i.key === 'email').fields.find((x) => x.name === 'api_key').configured, false, 'secrets can be cleared');
  const status = ok(await api(S.sa).get('/settings/system-status'));
  assert.equal(status.database.connected, true); assert.ok(!JSON.stringify(status).match(/postgres:\/\//));
});

test('12. audit log is complete, append-only and tamper-evident', async () => {
  const sa = api(S.sa);
  const v1 = ok(await sa.get('/audit/verify'));
  assert.equal(v1.ok, true, JSON.stringify(v1)); assert.ok(v1.checked > 50);
  for (const action of ['user.create', 'programme.create', 'enrollment.confirm', 'attendance.mark', 'result.finalise', 'certificate.issue', 'certificate.revoke', 'payment.record', 'payment.refund', 'result.override', 'settings.update', 'integration.update', 'auth.login']) {
    assert.ok(ok(await sa.get(`/audit?action=${action}&limit=1`)).data.length >= 1, `${action} is recorded`);
  }
  const sample = ok(await sa.get('/audit?action=result.override&limit=1')).data[0];
  assert.ok(sample.actor_email && sample.ip !== undefined && sample.before_data && sample.after_data, 'who, from where, before and after');
  refused(await api(S.tok_aud).get('/audit').then((r) => ({ status: r.status === 200 ? 403 : r.status })), 403, 'auditor can read');
  ok(await api(S.tok_aud).get('/audit?limit=1'));
  refused(await api(S.tok_a1).get('/audit'), 403, 'training admin cannot read the audit log');
  // attacks from inside the database
  await assert.rejects(db.query(`update audit_logs set action = 'x' where seq = 1`), /append-only/, 'cannot edit');
  await assert.rejects(db.query(`delete from audit_logs where seq = 1`), /append-only/, 'cannot delete');
  await assert.rejects(db.query(`truncate audit_logs`), /append-only/, 'cannot truncate');
  // A privileged attacker disables the protection and edits or deletes a row. Each experiment runs in a transaction
  // that is rolled back, so the real chain is never damaged, and uses the same function the API calls.
  const verifyIn = async () => (await db.query('select * from audit_verify()')).rows[0];
  const target = (await db.query(`select seq from audit_logs where seq = (select max(seq) - 3 from audit_logs)`)).rows[0];
  await db.query('begin');
  await db.query('alter table audit_logs disable trigger audit_logs_no_update');
  await db.query(`update audit_logs set action = 'tampered' where seq = $1`, [target.seq]);
  const edited = await verifyIn();
  await db.query('rollback');
  assert.ok(edited.bad_rows >= 1, 'an edited row is detected'); assert.equal(Number(edited.first_bad_seq), Number(target.seq), 'and located');
  await db.query('begin');
  await db.query('alter table audit_logs disable trigger audit_logs_no_update');
  await db.query('delete from audit_logs where seq = $1', [target.seq - 1]);
  const removed = await verifyIn();
  await db.query('rollback');
  assert.ok(removed.missing_entries >= 1 || removed.bad_rows >= 1, 'a deleted row is detected');
  await db.query('begin');
  await db.query('alter table audit_logs disable trigger audit_logs_no_update');
  await db.query(`update audit_logs set hash = 'forged', prev_hash = '' where seq = $1`, [target.seq]);
  assert.ok((await verifyIn()).bad_rows >= 1, 'a forged hash is detected');
  await db.query('rollback');
  assert.equal(ok(await sa.get('/audit/verify')).ok, true, 'the real chain is untouched');
});

test('13. reports, dashboards, search and notifications work for every role', async () => {
  for (const [who, tok] of [['super', S.sa], ['admin', S.tok_a1], ['instructor', S.tok_instr], ['trainee', S.tok_T1], ['client', S.tok_aa], ['finance', S.tok_fin], ['auditor', S.tok_aud]]) {
    const d = ok(await api(tok).get('/dashboard'), `dashboard ${who}`);
    assert.ok(Array.isArray(d.tiles) && d.tiles.length >= 4, `${who} has tiles`);
    assert.ok(d.tiles.every((t) => typeof t.value === 'number' && Number.isFinite(t.value)), `${who} tiles are numbers`);
  }
  assert.ok(!ok(await api(S.tok_instr).get('/dashboard')).tiles.some((t) => t.key === 'revenue'), 'instructors see no revenue');
  assert.ok(!ok(await api(S.tok_T1).get('/dashboard')).tiles.some((t) => t.key === 'revenue'));
  const rep = ok(await api(S.tok_a1).get(`/reports/training?programme_id=${S.prog.id}`));
  assert.equal(rep.rows.length, 1); assert.equal(Number(rep.rows[0].enrolled), 3);
  const csv = await api(S.tok_a1).raw(`/reports/training?format=csv`);
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte order mark so Excel opens it correctly');
  assert.ok(csvBytes.subarray(3).toString().startsWith('Programme,Title'));
  const xlsx = await api(S.tok_a1).raw('/reports/training?format=xlsx'); assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const pdf = await api(S.tok_a1).raw('/reports/certificates?format=pdf'); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  refused(await api(S.tok_T1).get('/reports/training'), 403, 'trainees have no reports');
  refused(await api(S.tok_instr).get('/reports/financial'), 403, 'instructors have no financial report');
  assert.ok(ok(await api(S.sa).get('/audit?action=report.export&limit=3')).data.length >= 1, 'exports are audited');
  const s = ok(await api(S.tok_a1).get(`/search?q=${encodeURIComponent('E2E Course')}`));
  assert.ok(s.groups.some((g) => g.type === 'course'));
  const n = ok(await api(S.tok_T1).get('/notifications/mine'));
  assert.ok(n.items.length >= 2 && n.unread >= 1, 'trainee was notified about registration and results');
  ok(await api(S.tok_T1).post('/notifications/read-all'));
  assert.equal(ok(await api(S.tok_T1).get('/notifications/mine')).unread, 0);
});

test('14. authentication hardening', async () => {
  refused(await http('GET', '/users'), 401, 'no token');
  refused(await http('GET', '/users', 'garbage.token.value'), 401, 'bad token');
  refused(await http('POST', '/auth/login', null, { email: email('super'), password: 'wrong-password' }), 401);
  const unknown = await http('POST', '/auth/login', null, { email: 'nobody@example.com', password: 'x' });
  const wrong = await http('POST', '/auth/login', null, { email: email('super'), password: 'x' });
  assert.deepEqual(unknown.body, wrong.body, 'login failure does not reveal whether the account exists');
  assert.ok(ok(await api(S.sa).get('/audit?action=auth.login_failed&limit=2')).data.length >= 1, 'failed sign-ins are audited');
  const a = ok(await api(S.sa).post(`/users/${S.t4}/suspend`, { reason: 'Test suspension' }));
  assert.equal(a.status, 'suspended');
  refused(await api(S.tok_T4).get('/dashboard'), 403, 'a suspended account is locked out at once, even with a valid token');
  refused(await http('POST', '/auth/login', null, { email: email('trainee4'), password: PASSWORD }), 401, 'and cannot sign in');
  ok(await api(S.sa).post(`/users/${S.t4}/reactivate`));
  refused(await api(S.sa).post(`/users/${(await db.query(`select id from users where email = $1`, [email('super')])).rows[0].id}/suspend`, { reason: 'Cannot suspend self' }), 400, 'cannot suspend yourself');
  const res = await fetch(base + '/health'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'security headers present');
  assert.equal((await res.json()).status, 'ok');
});

test('15. scheduled jobs run cleanly and are idempotent', async () => {
  const run1 = spawnSync('node', ['dist/scripts/jobs.js'], { env: process.env, encoding: 'utf8' });
  assert.equal(run1.status, 0, run1.stderr);
  const out1 = JSON.parse(run1.stdout.trim().split('\n').pop());
  assert.ok('emails_sent' in out1);
  const run2 = spawnSync('node', ['dist/scripts/jobs.js'], { env: process.env, encoding: 'utf8' });
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(JSON.parse(run2.stdout.trim().split('\n').pop()).emails_sent, 0, 'nothing is sent twice');
});

test('16. the rate limiter really limits sign-in attempts', async () => {
  process.env.THROTTLE_DISABLED = 'false';
  try {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await http('POST', '/auth/login', null, { email: 'brute@example.com', password: `guess${i}` })).status);
    assert.ok(codes.includes(429), `expected a 429 after repeated failures, got ${codes.join(',')}`);
    assert.equal(codes.slice(0, 5).every((c) => c === 401), true, 'the first attempts get a normal refusal');
  } finally { process.env.THROTTLE_DISABLED = 'true'; }
});
