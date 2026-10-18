// Exam-day load test. Boots the real app against a migrated database (AUTH_MODE=dev), seeds one class, then has every trainee
// start, autosave and submit at the same moment, and prints how long each step took.
//   DATABASE_URL=postgres://... AUTH_MODE=dev node test/load/exam-load.mjs [trainees=150] [questions=40]
// DB_LATENCY_MS=5 puts a 5 ms delay each way between the app and the database (about 10 ms round trip, like a hosted database).
// Not part of `npm test` (it lives in a sub-folder). Use a throw-away database.
import pg from 'pg';

const N = Number(process.argv[2] ?? 150);
const Q = Number(process.argv[3] ?? 40);
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }
process.env.AUTH_MODE ??= 'dev';
process.env.THROTTLE_DISABLED = 'true';
process.env.PROXY_SHARED_SECRET = 'load-test-proxy-secret-0123456789abcdef';
const seedUrl = process.env.DATABASE_URL;
const latency = Number(process.env.DB_LATENCY_MS ?? 0);
if (latency > 0) {
  // a TCP relay that delays every chunk, in order, so the app sees a database that is not on the same machine
  const { createServer, connect } = await import('node:net');
  const u = new URL(seedUrl);
  const upstream = { port: Number(u.port || 5432), host: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname };
  const relay = createServer((client) => {
    const server = connect(upstream.port, upstream.host);
    server.on('error', () => client.destroy());
    const pipe = (from, to) => { from.on('data', (d) => setTimeout(() => !to.destroyed && to.write(d), latency)); from.on('end', () => setTimeout(() => to.end(), latency)); from.on('error', () => to.destroy()); };
    pipe(client, server); pipe(server, client);
  });
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  u.hostname = '127.0.0.1'; u.port = String(relay.address().port);
  process.env.DATABASE_URL = u.toString();
}
const { createApp } = await import('../../dist/main.js');

const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = process.env.DEV_PASSWORD ?? 'ChangeMe!2026';
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const app = await createApp();
await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
const db = new pg.Client({ connectionString: seedUrl });
await db.connect();

async function http(method, path, token, body) {
  const t0 = performance.now();
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t0;
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, ms };
}
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
async function pool(items, size, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

// ---- seed
await db.query(`insert into users (email, full_name, role, status) values ($1,'Load Super','super_admin','active')`, [`load.super.${run}@example.com`]);
const sa = must(await http('POST', '/auth/login', null, { email: `load.super.${run}@example.com`, password: PASSWORD }), 'login').access_token;
const cat = must(await http('POST', '/course-categories', sa, { code: Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(''), name: `Load ${run}` }), 'category');
const course = must(await http('POST', '/courses', sa, { code: `LOAD-${run}`.toUpperCase(), title: `Load ${run}`, category_id: cat.id, duration_hours: 8, fee: 0, pass_mark: 50, min_attendance_pct: 0, validity_months: 12, capacity: N + 10, status: 'active' }), 'course');
const prog = must(await http('POST', '/programmes', sa, { course_id: course.id, start_date: day(-1), end_date: day(1), capacity: N + 10, fee: 0 }), 'programme');
const qs = [];
for (let i = 0; i < Q; i++) qs.push(must(await http('POST', '/questions', sa, { course_id: course.id, type: 'mcq_single', prompt: `Question ${i + 1} ${run}`, options: ['A', 'B', 'C', 'D'], answer: i % 4, marks: 1 }), 'question'));
const asm = must(await http('POST', '/assessments', sa, { course_id: course.id, programme_id: prog.id, title: `Load exam ${run}`, duration_minutes: 60, pass_mark: 50, max_attempts: 2, randomize: true }), 'assessment');
must(await http('PUT', `/assessments/${asm.id}/questions`, sa, { items: qs.map((q) => ({ question_id: q.id })) }), 'set questions');
must(await http('POST', `/assessments/${asm.id}/publish`, sa), 'publish');
const ids = (await db.query(`insert into users (email, full_name, role, status) select 'load.t' || g || '.${run}@example.com', 'Load Trainee ' || g, 'trainee', 'active' from generate_series(1,$1) g returning id, email`, [N])).rows;
await db.query(`insert into enrollments (programme_id, trainee_id, status) select $1, id, 'confirmed' from unnest($2::uuid[]) id`, [prog.id, ids.map((r) => r.id)]);
const tokens = await pool(ids, 20, async (r) => must(await http('POST', '/auth/login', null, { email: r.email, password: PASSWORD }), 'trainee login').access_token);
console.log(`seeded: ${N} trainees, ${Q} questions, db pool max ${process.env.DATABASE_POOL_MAX ?? 10}, database delay ${latency * 2} ms round trip\n`);

// ---- the exam, with everyone doing each step at the same moment
function report(label, rs, wall) {
  const ok = rs.filter((r) => r.status < 300), ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${label.padEnd(22)} ok ${String(ok.length).padStart(4)}/${rs.length}  wall ${wall.toFixed(0).padStart(6)} ms  p50 ${pct(ms, 50).toFixed(0).padStart(6)}  p95 ${pct(ms, 95).toFixed(0).padStart(6)}  max ${ms[ms.length - 1].toFixed(0).padStart(6)} ms${ok.length < rs.length ? `   FAILED: ${[...new Set(rs.filter((r) => r.status >= 300).map((r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 80)))].join(' | ')}` : ''}`);
}
async function phase(label, fn) { const t0 = performance.now(); const rs = await Promise.all(tokens.map(fn)); report(label, rs, performance.now() - t0); return rs; }

const started = await phase('everyone starts', (t) => http('POST', `/assessments/${asm.id}/start`, t));
const attempts = started.map((r) => ({ id: r.body.attempt?.id, order: (r.body.questions ?? []).map((q) => q.id) }));
for (let round = 1; round <= 3; round++) {
  await phase(`autosave round ${round}`, (t, i) => http('PUT', `/attempts/${attempts[i].id}/answers`, t, { answers: Object.fromEntries(attempts[i].order.slice(0, round * Math.ceil(Q / 3)).map((q) => [q, 1])) }));
}
await phase('everyone submits', (t, i) => http('POST', `/attempts/${attempts[i].id}/submit`, t));
const audits = (await db.query(`select count(*)::int n from audit_logs where action in ('attempt.start','attempt.submit') and actor_email like $1`, [`load.t%.${run}@example.com`])).rows[0].n;
const verify = (await db.query('select * from audit_verify()')).rows[0];
console.log(`\naudit rows written for the exam: ${audits} (expected ${N * 2}); chain check: ${Number(verify.bad_rows) === 0 && Number(verify.missing_entries) === 0 ? 'intact' : 'BROKEN ' + JSON.stringify(verify)}`);
await db.end(); await app.close(); process.exit(0);
