// Builds a realistic demo scenario through the API, so every screen has something to show.
// Needs the API running in development mode with seeded users (npm run seed -w apps/api).
// Everything it creates is clearly demo data (example.com addresses, "Demo" organisations).
//   API_URL=http://localhost:4000 node scripts/demo.mjs
const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = process.env.DEV_PASSWORD ?? 'ChangeMe!2026';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const at = (n, h) => `${day(n)}T${String(h).padStart(2, '0')}:00:00Z`;

async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 240)}`);
  return json;
}
const login = async (email) => (await call('POST', '/auth/login', null, { email, password: PASSWORD })).access_token;
const step = (m) => console.log('  ' + m);

console.log('Signing in the demo people…');
const [admin, admin2, instr, fin] = await Promise.all(['admin@example.com', 'admin2@example.com', 'instructor@example.com', 'finance@example.com'].map(login));
const trainees = {};
for (const n of [1, 2, 3, 4, 5]) trainees[n] = await login(`trainee${n}@example.com`);
const users = (await call('GET', '/users?role=trainee&limit=100', admin)).data;
const idOf = (n) => users.find((u) => u.email === `trainee${n}@example.com`).id;
const instrId = (await call('GET', '/users?role=instructor&limit=10', admin)).data[0].id;
const courses = (await call('GET', '/courses?limit=100', admin)).data;
const room = (await call('GET', '/classrooms', admin))[0];
const orgs = (await call('GET', '/organizations?limit=10', admin)).data;
const airport = orgs.find((o) => o.name === 'Demo Airport Company');

console.log('Activating courses…');
const rules = { SMS: { duration_hours: 16, fee: 1500, validity_months: 24, approving_body: 'Aligned to ICAO Annex 19 (placeholder: confirm with HAAB)' }, AVSEC: { duration_hours: 24, fee: 2200, validity_months: 24, approving_body: 'Aligned to ICAO Annex 17 (placeholder: confirm with HAAB)' } };
const sms = courses.find((c) => c.code === 'SMS-001'); const avsec = courses.find((c) => c.code === 'AVSEC-001');
for (const [c, r] of [[sms, rules.SMS], [avsec, rules.AVSEC]]) {
  await call('PATCH', `/courses/${c.id}`, admin, { ...r, status: 'active', capacity: 20, pass_mark: 70, min_attendance_pct: 80 });
  await call('PUT', `/courses/${c.id}/instructors`, admin, { ids: [instrId] });
  step(`${c.code} is active`);
}
const mod = await call('POST', `/courses/${sms.id}/modules`, admin, { title: 'Introduction to safety management', position: 0 });
await call('POST', `/modules/${mod.id}/materials`, admin, { title: 'ICAO Doc 9859, Safety Management Manual (link to add)', kind: 'link', url: 'https://www.icao.int/', required: true });
await call('POST', '/compliance/requirements', admin, { course_id: sms.id, organization_id: airport.id, grace_days: 30 });

console.log('Programme 1: a completed SMS course with results, certificates and payments…');
const p1 = await call('POST', '/programmes', admin, { course_id: sms.id, start_date: day(-12), end_date: day(-10), lead_instructor_id: instrId, classroom_id: room.id, capacity: 20, location: 'Head office training room' });
await call('POST', `/programmes/${p1.id}/status`, admin, { status: 'open_for_registration' });
const s1 = await call('POST', `/programmes/${p1.id}/sessions`, admin, { title: 'Day 1: safety fundamentals', starts_at: at(-12, 9), ends_at: at(-12, 16), instructor_id: instrId, classroom_id: room.id });
const s2 = await call('POST', `/programmes/${p1.id}/sessions`, admin, { title: 'Day 2: hazard identification and risk', starts_at: at(-11, 9), ends_at: at(-11, 16), instructor_id: instrId, classroom_id: room.id });
const enrol = {};
for (const n of [1, 2, 3]) { enrol[n] = await call('POST', '/enrollments', admin, { programme_id: p1.id, trainee_id: idOf(n) }); await call('POST', `/enrollments/${enrol[n].id}/confirm`, admin, {}); }
await call('POST', `/programmes/${p1.id}/status`, admin, { status: 'registration_closed' }); await call('POST', `/programmes/${p1.id}/status`, admin, { status: 'ongoing' });
await call('PUT', `/sessions/${s1.id}/attendance`, instr, { records: [1, 2, 3].map((n) => ({ trainee_id: idOf(n), status: 'present' })) });
await call('PUT', `/sessions/${s2.id}/attendance`, instr, { records: [{ trainee_id: idOf(1), status: 'present' }, { trainee_id: idOf(2), status: 'present' }, { trainee_id: idOf(3), status: 'absent' }] });
const q = [];
q.push(await call('POST', '/questions', instr, { course_id: sms.id, type: 'mcq_single', topic: 'Foundations', prompt: 'Which ICAO Annex sets out safety management provisions?', options: ['Annex 6', 'Annex 14', 'Annex 19', 'Annex 17'], answer: 2, marks: 2 }));
q.push(await call('POST', '/questions', instr, { course_id: sms.id, type: 'true_false', topic: 'Foundations', prompt: 'A safety management system is only needed after an accident has occurred.', answer: false, marks: 2 }));
q.push(await call('POST', '/questions', instr, { course_id: sms.id, type: 'mcq_multi', topic: 'Hazards', prompt: 'Which of these are sources of hazard information?', options: ['Voluntary reports', 'Safety audits', 'Staff birthdays', 'Inspection findings'], answer: [0, 1, 3], marks: 3 }));
q.push(await call('POST', '/questions', instr, { course_id: sms.id, type: 'essay', topic: 'Risk', prompt: 'Explain how you would assess the risk of a hazard on the apron.', marks: 6 }));
const asm = await call('POST', '/assessments', instr, { course_id: sms.id, programme_id: p1.id, title: 'SMS final assessment', duration_minutes: 45, pass_mark: 70, max_attempts: 2, release_mode: 'manual' });
await call('PUT', `/assessments/${asm.id}/questions`, instr, { items: q.map((x) => ({ question_id: x.id })) });
await call('POST', `/assessments/${asm.id}/publish`, instr, {});
const sit = async (n, answers) => { const s = await call('POST', `/assessments/${asm.id}/start`, trainees[n]); await call('PUT', `/attempts/${s.attempt.id}/answers`, trainees[n], { answers }); await call('POST', `/attempts/${s.attempt.id}/submit`, trainees[n], {}); return s.attempt.id; };
const a1 = await sit(1, { [q[0].id]: 2, [q[1].id]: false, [q[2].id]: [0, 1, 3], [q[3].id]: 'Identify the hazard, estimate how likely and how severe it is, rate the risk, then decide controls and review them.' });
const a2 = await sit(2, { [q[0].id]: 1, [q[1].id]: true, [q[2].id]: [0, 1], [q[3].id]: 'Check it.' });
await call('PUT', `/attempts/${a1}/mark`, instr, { marks: [{ question_id: q[3].id, awarded_marks: 5, feedback: 'Clear method. Add who owns the controls.' }] });
await call('PUT', `/attempts/${a2}/mark`, instr, { marks: [{ question_id: q[3].id, awarded_marks: 1, feedback: 'Too brief. Describe each step.' }] });
await call('POST', `/assessments/${asm.id}/release`, instr, {});
await call('POST', `/programmes/${p1.id}/status`, admin, { status: 'completed' });
await call('POST', `/programmes/${p1.id}/results/compute`, admin);
await call('POST', `/programmes/${p1.id}/results/finalise-all`, admin2);   // a different person from the marker
await call('POST', `/programmes/${p1.id}/results/release`, admin2);
step('3 trainees, 1 pass with certificate, 1 fail, 1 absent');

console.log('Payments…');
const invs = (await call('GET', `/invoices?programme_id=${p1.id}&limit=50`, fin)).data;
for (const [i, inv] of invs.entries()) {
  if (i === 0) await call('POST', `/invoices/${inv.id}/payments`, fin, { amount: Number(inv.total), method: 'bank_transfer', reference: 'TT-20418' });
  else if (i === 1) await call('POST', `/invoices/${inv.id}/payments`, fin, { amount: Number(inv.total) / 2, method: 'mobile_money', reference: 'MM-77120' });
}

console.log('Programme 2: an AVSEC course in progress…');
const p2 = await call('POST', '/programmes', admin, { course_id: avsec.id, start_date: day(-1), end_date: day(2), lead_instructor_id: instrId, capacity: 12, location: 'Client site' });
await call('POST', `/programmes/${p2.id}/status`, admin, { status: 'open_for_registration' });
await call('POST', `/programmes/${p2.id}/sessions`, admin, { title: 'Day 1: Annex 17 overview', starts_at: at(-1, 9), ends_at: at(-1, 16), instructor_id: instrId });
await call('POST', `/programmes/${p2.id}/sessions`, admin, { title: 'Day 2: screening practice', starts_at: at(0, 9), ends_at: at(0, 16), instructor_id: instrId });
await call('POST', `/programmes/${p2.id}/sessions`, admin, { title: 'Day 3: threat response', starts_at: at(1, 9), ends_at: at(1, 16), instructor_id: instrId });
for (const n of [4, 5]) { const e = await call('POST', '/enrollments', admin, { programme_id: p2.id, trainee_id: idOf(n) }); await call('POST', `/enrollments/${e.id}/confirm`, admin, {}); }
await call('POST', `/programmes/${p2.id}/status`, admin, { status: 'registration_closed' }); await call('POST', `/programmes/${p2.id}/status`, admin, { status: 'ongoing' });

console.log('Programme 3: open for registration…');
const p3 = await call('POST', '/programmes', admin, { course_id: sms.id, start_date: day(21), end_date: day(23), lead_instructor_id: instrId, capacity: 20, registration_deadline: day(14), location: 'Head office training room' });
await call('POST', `/programmes/${p3.id}/status`, admin, { status: 'open_for_registration' });
await call('POST', `/programmes/${p3.id}/sessions`, admin, { title: 'Day 1', starts_at: at(21, 9), ends_at: at(21, 16), instructor_id: instrId });
await call('POST', '/enrollments', trainees[1], { programme_id: p3.id });
console.log('Done. Sign in as any seeded email (admin@example.com, instructor@example.com, trainee1@example.com, finance@example.com ...) with the dev password.');
