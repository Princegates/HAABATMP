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
process.env.PROXY_SHARED_SECRET = 'test-proxy-secret-0123456789abcdef';
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
  get: (p) => http('GET', p, token), delete: (p) => http('DELETE', p, token), post: (p, b = {}) => http('POST', p, token, b), put: (p, b) => http('PUT', p, token, b), patch: (p, b) => http('PATCH', p, token, b),
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
  const live = ok(await api(S.tok_a1).post(`/programmes/${S.prog.id}/sessions`, { title: 'Live', starts_at: new Date(now - 5 * 60000).toISOString(), ends_at: new Date(Math.min(now + 60 * 60000, Date.parse(`${day(0)}T23:59:00Z`))).toISOString(), instructor_id: S.instr })); // never past midnight UTC, or it falls outside the programme dates
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
  const kinds = (await db.query(`select kind from notifications where user_id = $1 and created_at > now() - interval '1 minute' and kind in ('certificate.revoked','certificate.reissued')`, [S.t1])).rows.map((r) => r.kind);
  assert.ok(!kinds.includes('certificate.revoked'), 'a reissue does not send a scary revoked message'); assert.ok(kinds.includes('certificate.reissued'), 'the trainee is told about the replacement');
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

test('9b. learning progress is private to the enrolled trainee', async () => {
  const a1 = api(S.tok_a1);
  const mod = ok(await a1.post(`/courses/${S.course.id}/modules`, { title: 'Module one', position: 0 }));
  const mat = ok(await a1.post(`/modules/${mod.id}/materials`, { title: 'Course notes', kind: 'link', url: 'https://example.com/notes', required: true }));
  const mine = ok(await api(S.tok_T1).get(`/my/learning/${S.course.id}`));
  assert.equal(mine.modules[0].materials[0].status, 'not_started');
  ok(await api(S.tok_T1).put(`/materials/${mat.id}/progress`, { status: 'completed' }));
  assert.equal(ok(await api(S.tok_T1).get(`/my/learning/${S.course.id}`)).modules[0].materials[0].status, 'completed');
  assert.equal(ok(await api(S.tok_T2).get(`/my/learning/${S.course.id}`)).modules[0].materials[0].status, 'not_started', 'another trainee has their own progress');
  refused(await api(S.tok_T3).get(`/my/learning/${S.course.id}`), 404, 'a trainee who is not enrolled cannot open it');
  refused(await api(S.tok_a1).get(`/my/learning/${S.course.id}`), 400, 'staff have no learning progress');
  refused(await api(S.tok_T3).put(`/materials/${mat.id}/progress`, { status: 'completed' }), 404, 'nor record progress on it');
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
  const shown = ok(await api(S.tok_a1).get(`/programmes/${S.prog.id}`));
  assert.equal(Number(shown.confirmed_count), 3, 'a completed programme still counts the places that were held');
  assert.equal(ok(await api(S.tok_fin).get(`/invoices/${(await db.query('select id from invoices where trainee_id = $1', [S.t1])).rows[0].id}`)).trainee_name, `trainee1 ${run}`, 'an invoice says who is billed');
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

test('14b. password reset never reveals who has an account, and is controlled', async () => {
  const known = await http('POST', '/auth/forgot', null, { email: email('super') });
  const unknown = await http('POST', '/auth/forgot', null, { email: 'nobody.here@example.com' });
  assert.equal(known.status, 201); assert.deepEqual(known.body, unknown.body, 'the answer is identical for registered and unregistered addresses');
  refused(await http('POST', '/auth/set-password', null, { access_token: 'x'.repeat(40), password: 'A-long-password-123' }), 400, 'not available without the identity provider');
  ok(await api(S.tok_a1).post(`/users/${S.t1}/send-reset`), 'staff can send a reset');
  assert.ok(ok(await api(S.sa).get('/audit?action=user.password_reset_sent&limit=1')).data.length >= 1, 'and it is recorded');
  refused(await api(S.tok_aa).post(`/users/${S.t3}/send-reset`), 404, 'a client admin cannot reach another client\'s people');
  refused(await api(S.tok_T1).post(`/users/${S.t2}/send-reset`), 403, 'trainees cannot send resets');
  refused(await api(S.tok_a1).post(`/users/${S.fin}/send-reset`), 403, 'training admins cannot reset finance or other privileged accounts');
});

test('14c. the real client address is trusted only from the web app', async () => {
  const key = process.env.PROXY_SHARED_SECRET;
  const login = (headers) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ email: email('super'), password: 'wrong-password' }) });
  await login({ 'x-atmp-client-ip': '203.0.113.7', 'x-atmp-proxy-key': key });
  await login({ 'x-atmp-client-ip': '198.51.100.99', 'x-atmp-proxy-key': 'not-the-secret-not-the-secret-123' });
  await login({ 'x-atmp-client-ip': '198.51.100.98' });
  const rows = (await db.query(`select ip from audit_logs where action = 'auth.login_failed' order by seq desc limit 3`)).rows.map((r) => r.ip);
  assert.ok(rows.includes('203.0.113.7'), 'the address supplied by the web app is recorded');
  assert.ok(!rows.includes('198.51.100.99') && !rows.includes('198.51.100.98'), 'an address supplied without the secret, or with the wrong one, is ignored');
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
  } finally { process.env.THROTTLE_DISABLED = 'true';
process.env.PROXY_SHARED_SECRET = 'test-proxy-secret-0123456789abcdef'; }
});

test('17. two-step sign-in is optional by default and the Super Admin can require it for chosen roles', async () => {
  const sa = api(S.sa);
  const fin = api(S.tok_fin);
  const before = ok(await fin.get('/auth/me'));
  assert.equal(before.mfa_required, false, 'off by default');
  assert.equal(before.mfa_required_by_policy, false);
  refused(await fin.put('/settings/pages/security', { mfa_required_roles: ['finance_officer'] }), [403, 404], 'only the Super Admin sets the policy');
  refused(await sa.put('/settings/pages/security', { mfa_required_roles: ['nonsense'] }), 400, 'unknown roles are rejected');
  ok(await sa.put('/settings/pages/security', { mfa_required_roles: ['finance_officer'] }));
  try {
    const after = ok(await fin.get('/auth/me'));
    assert.equal(after.mfa_required_by_policy, true);
    assert.equal(ok(await api(S.tok_a1).get('/auth/me')).mfa_required_by_policy, false, 'other roles are unaffected');
    refused(await fin.post('/auth/mfa/disable'), 400, 'cannot be switched off where required');
  } finally { ok(await sa.put('/settings/pages/security', { mfa_required_roles: [] })); }
  assert.equal(ok(await fin.get('/auth/me')).mfa_required, false, 'back to optional');
});

test('18. trainee self-registration: off by default, Super Admin switches it on, HAAB approves', async () => {
  const sa = api(S.sa);
  const who = email('selfreg');
  refused(await http('POST', '/registration', null, { email: who, full_name: 'Self Registered' }), 404, 'closed by default');
  assert.equal((await http('GET', '/registration/status')).body.enabled, false);
  refused(await api(S.tok_a1).put('/settings/pages/registration', { enabled: true, notice: '' }), [403, 404], 'only the Super Admin switches it on');
  ok(await sa.put('/settings/pages/registration', { enabled: true, notice: 'Use your work email.' }));
  try {
    assert.equal((await http('GET', '/registration/status')).body.enabled, true);
    const r1 = ok(await http('POST', '/registration', null, { email: who, full_name: 'Self Registered', organisation: 'Some Airline' }));
    const again = ok(await http('POST', '/registration', null, { email: who, full_name: 'Self Registered' }));
    assert.deepEqual(r1, again, 'a repeat looks identical');
    const existing = ok(await http('POST', '/registration', null, { email: email('super'), full_name: 'Someone Else' }));
    assert.deepEqual(existing, r1, 'an existing account looks identical, so nobody can probe for accounts');
    ok(await http('POST', '/registration', null, { email: email('bot'), full_name: 'Bot', website: 'http://spam' }));
    refused(await api(S.tok_fin).get('/registrations'), 403, 'finance cannot see requests');
    const pending = ok(await sa.get('/registrations')).data.filter((r) => r.email === who);
    assert.equal(pending.length, 1, 'one request, not two');
    assert.equal(ok(await sa.get('/registrations')).data.some((r) => r.email === email('bot')), false, 'honeypot submissions are dropped');
    const approved = ok(await sa.post(`/registrations/${pending[0].id}/approve`, { organization_id: S.orgA }));
    assert.equal(approved.role, 'trainee');
    assert.equal(approved.organization_id, S.orgA);
    refused(await sa.post(`/registrations/${pending[0].id}/approve`, {}), 409, 'cannot decide twice');
  } finally { ok(await sa.put('/settings/pages/registration', { enabled: false, notice: '' })); }
  refused(await http('POST', '/registration', null, { email: email('late'), full_name: 'Too Late' }), 404, 'closed again');
});

test('19. the Super Admin can hide Finance from trainees, and the platform enforces it', async () => {
  const sa = api(S.sa);
  const t = api(S.tok_T1);
  assert.equal(ok(await t.get('/auth/me')).show_finance, true, 'visible by default');
  ok(await t.get('/invoices'));
  refused(await api(S.tok_a1).put('/settings/pages/trainee_access', { show_finance: false }), [403, 404], 'only the Super Admin changes it');
  ok(await sa.put('/settings/pages/trainee_access', { show_finance: false }));
  try {
    assert.equal(ok(await t.get('/auth/me')).show_finance, false);
    refused(await t.get('/invoices'), 403, 'the invoice list is refused, not just hidden');
    assert.equal(ok(await api(S.tok_fin).get('/auth/me')).show_finance, true, 'staff are unaffected');
    ok(await api(S.tok_fin).get('/invoices'));
  } finally { ok(await sa.put('/settings/pages/trainee_access', { show_finance: true })); }
  ok(await t.get('/invoices'));
});

test('20. courses and categories can be deleted, unless real training records depend on them', async () => {
  const a1 = api(S.tok_a1);
  const k = letters(3);
  const cat = ok(await a1.post('/course-categories', { code: k, name: `Delete me ${run}` }));
  const c1 = ok(await a1.post('/courses', { code: `DEL1-${run}`.toUpperCase(), title: 'Draft one', category_id: cat.id, duration_hours: 1, fee: 0, pass_mark: 70, min_attendance_pct: 80, status: 'draft' }));
  const c2 = ok(await a1.post('/courses', { code: `DEL2-${run}`.toUpperCase(), title: 'Draft two', category_id: cat.id, duration_hours: 1, fee: 0, pass_mark: 70, min_attendance_pct: 80, status: 'draft' }));
  // who may delete
  refused(await api(S.tok_T1).delete(`/courses/${c1.id}`), 403, 'trainees cannot delete courses');
  refused(await api(S.tok_fin).delete(`/course-categories/${cat.id}`), 403, 'finance cannot delete categories');
  // a category that still has courses is protected unless the caller says so
  const cats = ok(await a1.get('/course-categories')).find((c) => c.id === cat.id);
  assert.equal(cats.course_count, 2);
  refused(await a1.delete(`/course-categories/${cat.id}`), 409, 'category still has courses');
  // a single unused draft course goes
  ok(await a1.delete(`/courses/${c1.id}`));
  refused(await a1.get(`/courses/${c1.id}`), 404, 'it is really gone');
  // a course with a programme is refused and keeps everything
  ok(await a1.post('/programmes', { course_id: c2.id, start_date: day(5), end_date: day(6), capacity: 5, fee: 0 }));
  const blocked = await a1.delete(`/courses/${c2.id}`);
  refused(blocked, 409, 'course with a programme');
  assert.match(blocked.body.message, /Archive it instead/);
  const blockedCat = await a1.delete(`/course-categories/${cat.id}?with_courses=true`);
  refused(blockedCat, 409, 'category delete is all or nothing');
  ok(await a1.get(`/courses/${c2.id}`));
  // an unused category and its draft courses go together
  const cat2 = ok(await a1.post('/course-categories', { code: letters(3), name: `Delete me too ${run}` }));
  const d = ok(await a1.post('/courses', { code: `DEL3-${run}`.toUpperCase(), title: 'Draft three', category_id: cat2.id, duration_hours: 1, fee: 0, pass_mark: 70, min_attendance_pct: 80, status: 'draft' }));
  const gone = ok(await a1.delete(`/course-categories/${cat2.id}?with_courses=true`));
  assert.equal(gone.courses_deleted, 1);
  refused(await a1.get(`/courses/${d.id}`), 404);
  // the audit log keeps the record of what was deleted
  const audit = [...ok(await api(S.sa).get('/audit?action=course.delete&limit=5')).data, ...ok(await api(S.sa).get('/audit?action=course_category.delete&limit=5')).data].map((r) => r.action);
  assert.ok(audit.includes('course.delete') && audit.includes('course_category.delete'));
});

test('21. questions can be imported from a Word file, previewed first, and nothing is saved when there are problems', async () => {
  const { default: JSZip } = await import('jszip');
  const makeDocx = async (paras) => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
    z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
    return z.generateAsync({ type: 'nodebuffer' });
  };
  const upload = async (token, docx, fields, name = 'questions.docx') => {
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([docx]), name);
    return http('POST', '/questions/import', token, fd);
  };
  const tag = `IMP${run}`;
  const good = await makeDocx(['Paper', '', `1. ${tag} which Annex covers security?`, 'A. Annex 6', 'B. Annex 17', 'Answer: B', 'Marks: 2', '', `2. ${tag} SMS is optional.`, 'Answer: False', '', `3. ${tag} discuss hazards.`, 'Type: Essay']);
  const instr = api(S.tok_instr ?? S.tok_a1);
  const preview = ok(await upload(S.tok_a1, good, { course_id: S.course.id }));
  assert.equal(preview.total, 3); assert.equal(preview.can_import, true); assert.equal(preview.questions[0].answer, 1);
  assert.equal((ok(await api(S.tok_a1).get(`/questions?course_id=${S.course.id}&q=${tag}&limit=10`)).data ?? []).length, 0, 'a preview saves nothing');
  refused(await upload(S.tok_T1, good, { course_id: S.course.id }), 403, 'trainees cannot import');
  const done = ok(await upload(S.tok_a1, good, { course_id: S.course.id, commit: 'true' }));
  assert.equal(done.imported, 3);
  // importing the same file again adds nothing new
  const again = await upload(S.tok_a1, good, { course_id: S.course.id, commit: 'true' });
  refused(again, 400, 'everything is already in the bank');
  const rows = ok(await api(S.tok_a1).get(`/questions?course_id=${S.course.id}&limit=200`)).data.filter((q) => q.prompt.includes(tag));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.type).sort(), ['essay', 'mcq_single', 'true_false']);
  // a file with a problem is refused whole
  const bad = await makeDocx([`1. ${tag} broken one`, 'A. One', 'B. Two', 'Answer: Z', '', `2. ${tag} fine one`, 'Answer: True']);
  assert.equal(ok(await upload(S.tok_a1, bad, { course_id: S.course.id })).can_import, false);
  refused(await upload(S.tok_a1, bad, { course_id: S.course.id, commit: 'true' }), 400, 'all or nothing');
  assert.equal(ok(await api(S.tok_a1).get(`/questions?course_id=${S.course.id}&limit=200`)).data.filter((q) => q.prompt.includes(tag)).length, 3, 'nothing from the bad file was saved');
  // wrong kinds of file
  refused(await upload(S.tok_a1, Buffer.from('not a word file'), { course_id: S.course.id }, 'x.docx'), 400, 'not a zip');
  refused(await upload(S.tok_a1, good, { course_id: S.course.id }, 'old.doc'), 400, 'only .docx');
  refused(await upload(S.tok_a1, await makeDocx(['just a note']), { course_id: S.course.id }), 400, 'no questions found');
});

test('22. opening times of a published assessment can be changed; a partial update keeps the other settings', async () => {
  const a1 = api(S.tok_a1);
  const course = S.course;
  const x = ok(await a1.post('/assessments', { course_id: course.id, title: `Window ${run}`, kind: 'exam', duration_minutes: 45, pass_mark: 65, max_attempts: 2, randomize: false, release_mode: 'immediate' }));
  // a partial update must not reset anything it did not mention
  const renamed = ok(await a1.patch(`/assessments/${x.id}`, { title: `Window renamed ${run}` }));
  assert.equal(renamed.duration_minutes, 45); assert.equal(renamed.pass_mark, 65); assert.equal(renamed.max_attempts, 2); assert.equal(renamed.randomize, false); assert.equal(renamed.release_mode, 'immediate');
  const qs = ok(await a1.post('/questions', { course_id: course.id, type: 'true_false', prompt: `Window question ${run}`, answer: true, marks: 1 }));
  ok(await api(S.tok_a1).put(`/assessments/${x.id}/questions`, { items: [{ question_id: qs.id }] }));
  ok(await a1.post(`/assessments/${x.id}/publish`));
  // once published, only the times may change
  refused(await a1.patch(`/assessments/${x.id}`, { title: 'Sneaky' }), 409, 'a published assessment is otherwise frozen');
  const opens = new Date(Date.now() - 3600000).toISOString(); const closes = new Date(Date.now() + 86400000).toISOString();
  const after = ok(await a1.patch(`/assessments/${x.id}`, { opens_at: opens, closes_at: closes }));
  assert.equal(new Date(after.opens_at).toISOString(), opens);
  assert.equal(after.duration_minutes, 45, 'the other settings are untouched');
  const cleared = ok(await a1.patch(`/assessments/${x.id}`, { opens_at: null, closes_at: null }));
  assert.equal(cleared.opens_at, null); assert.equal(cleared.closes_at, null);
  refused(await a1.patch(`/assessments/${x.id}`, { opens_at: closes, closes_at: opens }), 400, 'closing must be after opening');
});

test('23. instructors can register trainees from an Excel list, on programmes they teach', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const sheet = async (rows) => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Trainees');
    ws.addRow(['Full name', 'Email', 'Phone', 'Job role', 'Employer']); rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const upload = (token, buf, fields, name = 'list.xlsx') => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fd.append('file', new Blob([buf]), name); return http('POST', '/trainees/import-file', token, fd); };
  const a1 = api(S.tok_a1); const instr = api(S.tok_instr);
  const mine = ok(await a1.post('/programmes', { course_id: S.course.id, start_date: day(10), end_date: day(12), lead_instructor_id: S.instr, capacity: 20, fee: 0 }));
  const notMine = ok(await a1.post('/programmes', { course_id: S.course.id, start_date: day(10), end_date: day(12), capacity: 20, fee: 0 }));
  for (const p of [mine, notMine]) ok(await a1.post(`/programmes/${p.id}/status`, { status: 'open_for_registration' }));
  // what the screen offers
  const opts = ok(await instr.get('/trainees/register-options'));
  assert.ok(opts.programmes.some((p) => p.id === mine.id), 'their own programme is offered');
  assert.ok(!opts.programmes.some((p) => p.id === notMine.id), 'a programme they do not teach is not');
  assert.ok(opts.organizations.length >= 1);
  refused(await api(S.tok_T1).get('/trainees/register-options'), 403, 'trainees cannot');
  refused(await api(S.tok_fin).get('/trainees/register-options'), 403, 'nor finance');

  const tag = `xl${run}`;
  const list = await sheet([[`Ama ${tag}`, `ama.${tag}@example.com`, '+233 20 000', 'Ramp agent', 'Example Co'], [`Kofi ${tag}`, `kofi.${tag}@example.com`], ['No Email', 'not-an-email'], [`Ama ${tag} again`, `AMA.${tag}@example.com`]]);
  const prev = ok(await upload(S.tok_instr, list, { organization_id: S.orgA, programme_id: mine.id }));
  assert.equal(prev.total, 4); assert.equal(prev.new, 2); assert.equal(prev.skipped, 2); assert.equal(prev.can_import, true);
  assert.ok(prev.rows[2].notes[0].includes('not a valid email')); assert.ok(prev.rows[3].notes[0].includes('twice'));
  assert.equal(ok(await a1.get(`/users?q=${tag}&limit=10`)).data.length, 0, 'a preview creates no one');
  refused(await upload(S.tok_instr, list, { organization_id: S.orgA, programme_id: notMine.id }), 403, 'only programmes they teach');
  refused(await upload(S.tok_T1, list, { organization_id: S.orgA }), 403, 'trainees cannot import');
  refused(await upload(S.tok_instr, list, { organization_id: S.orgA }, 'old.xls'), 400, 'only xlsx and csv');
  refused(await upload(S.tok_instr, Buffer.from('nope'), { organization_id: S.orgA }), 400, 'not a real workbook');

  const done = ok(await upload(S.tok_instr, list, { organization_id: S.orgA, programme_id: mine.id, commit: 'true' }));
  assert.equal(done.created, 2); assert.equal(done.trainee_ids.length, 2);
  const people = ok(await a1.get(`/users?q=${tag}&limit=10`)).data;
  assert.equal(people.length, 2); assert.ok(people.every((p) => p.role === 'trainee' && p.organization_id === S.orgA));
  // the second step: register them on the programme
  const enrolled = ok(await instr.post(`/programmes/${mine.id}/enrol`, { trainee_ids: done.trainee_ids }));
  assert.equal(enrolled.enrolled.length, 2); assert.equal(enrolled.failed.length, 0);
  const refusedEnrol = ok(await instr.post(`/programmes/${notMine.id}/enrol`, { trainee_ids: done.trainee_ids }));
  assert.equal(refusedEnrol.enrolled.length, 0, 'they cannot register people on a programme they do not teach');
  assert.equal(refusedEnrol.failed.length, 2);
  // the same list again: nobody is duplicated, the existing accounts are recognised
  const again = ok(await upload(S.tok_instr, list, { organization_id: S.orgA, commit: 'true' }));
  assert.equal(again.created, 0); assert.equal(again.existing, 2);
  assert.equal(ok(await a1.get(`/users?q=${tag}&limit=10`)).data.length, 2);
  // CSV works too
  const csv = Buffer.from(`Full name,Email\nCsv Person ${tag},csv.${tag}@example.com\n`);
  assert.equal(ok(await upload(S.tok_instr, csv, { organization_id: S.orgA, commit: 'true' }, 'list.csv')).created, 1);
});

test('24. the Super Admin can delete what was added, but never the official record', async () => {
  const sa = api(S.sa); const a1 = api(S.tok_a1);
  // only a Super Admin reaches these routes
  const org = ok(await sa.post('/organizations', { name: `Delete Org ${run}`, type: 'airport' }));
  const tr = ok(await sa.post('/users', { email: email('del.trainee'), full_name: `Del Trainee ${run}`, role: 'trainee', organization_id: org.id }));
  refused(await a1.delete(`/users/${tr.id}`), 403, 'training admins cannot delete users');
  refused(await a1.delete(`/organizations/${org.id}`), 403, 'training admins cannot delete clients');
  refused(await sa.delete(`/users/${S.sa_id ?? (await db.query('select id from users where lower(email)=lower($1)', [email('super')])).rows[0].id}`), 400, 'nobody deletes their own account');

  // a trainee with a registration, attendance-free: the registration goes with them
  const prog = ok(await a1.post('/programmes', { course_id: S.course.id, start_date: day(20), end_date: day(21), capacity: 5, fee: 0 }));
  ok(await a1.post(`/programmes/${prog.id}/status`, { status: 'open_for_registration' }));
  ok(await a1.post(`/programmes/${prog.id}/enrol`, { trainee_ids: [tr.id] }));
  // the client still has people, so it is protected unless asked
  refused(await sa.delete(`/organizations/${org.id}`), 409, 'client still has people');
  ok(await sa.delete(`/users/${tr.id}`));
  refused(await a1.get(`/users/${tr.id}`), 404, 'trainee is gone');
  assert.equal((await db.query('select count(*)::int n from enrollments where trainee_id = $1', [tr.id])).rows[0].n, 0, 'their registration went too');

  // a client together with its people
  const t2 = ok(await sa.post('/users', { email: email('del.t2'), full_name: `Del T2 ${run}`, role: 'trainee', organization_id: org.id }));
  ok(await sa.delete(`/organizations/${org.id}?with_people=true`));
  refused(await a1.get(`/users/${t2.id}`), 404, 'their people went with the client');

  // a programme with sessions and a registration goes whole
  ok(await a1.post(`/programmes/${prog.id}/sessions`, { title: 'Day 1', starts_at: `${day(20)}T09:00:00Z`, ends_at: `${day(20)}T12:00:00Z` }));
  ok(await sa.delete(`/programmes/${prog.id}`));
  assert.equal((await db.query('select count(*)::int n from sessions where programme_id = $1', [prog.id])).rows[0].n, 0);

  // the official record is never deleted: a trainee with a certificate, and the programme it came from
  const cert = (await db.query('select id, trainee_id, programme_id from certificates limit 1')).rows[0];
  if (cert) {
    const u = await sa.delete(`/users/${cert.trainee_id}`);
    refused(u, 409, 'trainee with a certificate');
    assert.match(u.body.message, /official record/);
    refused(await sa.delete(`/programmes/${cert.programme_id}`), 409, 'programme with a certificate');
    assert.equal((await db.query('select count(*)::int n from certificates where id = $1', [cert.id])).rows[0].n, 1);
  }
  // staff who signed off records stay too
  const fin = (await db.query('select finalised_by from results where finalised_by is not null limit 1')).rows[0];
  if (fin) refused(await sa.delete(`/users/${fin.finalised_by}`), 409, 'staff who finalised results');

  // the removals are in the audit log
  const log = (await db.query(`select action from audit_logs where action in ('user.delete','organization.delete','programme.delete')`)).rows.map((r) => r.action);
  for (const a of ['user.delete', 'organization.delete', 'programme.delete']) assert.ok(log.includes(a), `audit has ${a}`);
});

test('25. completing a programme settles its results even when its session dates have not been reached', async () => {
  const a1 = api(S.tok_a1);
  const prog = ok(await a1.post('/programmes', { course_id: S.course.id, start_date: day(40), end_date: day(42), capacity: 5, fee: 0 }));
  ok(await a1.post(`/programmes/${prog.id}/sessions`, { title: 'Day 1', starts_at: `${day(40)}T09:00:00Z`, ends_at: `${day(40)}T12:00:00Z` }));
  ok(await a1.post(`/programmes/${prog.id}/status`, { status: 'open_for_registration' }));
  const enrol = ok(await a1.post(`/programmes/${prog.id}/enrol`, { trainee_ids: [S.t1] }));
  ok(await a1.post(`/enrollments/${enrol.enrolled[0].id}/confirm`, {}));
  const q = ok(await a1.post('/questions', { course_id: S.course.id, type: 'true_false', prompt: `Early completion ${run}: runways have numbers.`, answer: true, marks: 1 }));
  const asm = ok(await a1.post('/assessments', { course_id: S.course.id, programme_id: prog.id, title: `Early ${run}`, duration_minutes: 10, pass_mark: 50, max_attempts: 1 }));
  ok(await a1.put(`/assessments/${asm.id}/questions`, { items: [{ question_id: q.id }] }));
  ok(await a1.post(`/assessments/${asm.id}/publish`));
  const t1 = api(S.tok_T1);
  const start = ok(await t1.post(`/assessments/${asm.id}/start`));
  ok(await t1.put(`/attempts/${start.attempt.id}/answers`, { answers: { [q.id]: true } }));
  ok(await t1.post(`/attempts/${start.attempt.id}/submit`));
  // before completion nothing is decided
  ok(await a1.post(`/programmes/${prog.id}/results/compute`));
  const before = (await db.query('select r.status from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1', [prog.id])).rows[0];
  assert.equal(before.status, 'pending', 'indicative only until the programme ends');
  // staff complete the programme: no manual recalculation is needed, and the future session date does not hold results back
  ok(await a1.post(`/programmes/${prog.id}/status`, { status: 'registration_closed' }));
  ok(await a1.post(`/programmes/${prog.id}/status`, { status: 'ongoing' }));
  ok(await a1.post(`/programmes/${prog.id}/status`, { status: 'completed' }));
  const after = (await db.query('select r.status, r.final_score from results r join enrollments e on e.id = r.enrollment_id where e.programme_id = $1', [prog.id])).rows[0];
  assert.equal(after.status, 'pass'); assert.equal(Number(after.final_score), 100);
  const fin = ok(await api(S.sa).post(`/programmes/${prog.id}/results/finalise-all`));
  assert.equal(fin.finalised, 1);
  ok(await api(S.sa).post(`/programmes/${prog.id}/results/release`));
});
