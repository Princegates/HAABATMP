// Certificate download load test: many people download their certificate at once while a probe measures how long a trivial request waits.
//   DATABASE_URL=postgres://... AUTH_MODE=dev node test/load/pdf-load.mjs [downloads=30]
// Uses certificates already in the (throw-away) database. Not part of `npm test`.
import pg from 'pg';
import { rmSync } from 'node:fs';
import path from 'node:path';
const N = Number(process.argv[2] ?? 30);
process.env.AUTH_MODE ??= 'dev'; process.env.THROTTLE_DISABLED = 'true'; process.env.PROXY_SHARED_SECRET = 'load-test-proxy-secret-0123456789abcdef';
const { createApp } = await import('../../dist/main.js');
const app = await createApp(); await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const run = Math.random().toString(36).slice(2, 8);
await db.query(`insert into users (email, full_name, role, status) values ($1,'Pdf Super','super_admin','active')`, [`pdf.super.${run}@example.com`]);
const token = (await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `pdf.super.${run}@example.com`, password: process.env.DEV_PASSWORD ?? 'ChangeMe!2026' }) })).json()).access_token;
const certs = (await db.query(`select id from certificates where status = 'valid' order by created_at desc limit $1`, [N])).rows;
if (certs.length < N) console.log(`only ${certs.length} certificates in the database`);

async function round(label) {
  let worst = 0, stop = false;
  const probe = (async () => { while (!stop) { const t = performance.now(); await fetch(base + '/health'); worst = Math.max(worst, performance.now() - t); await new Promise((r) => setTimeout(r, 20)); } })();
  const t0 = performance.now();
  const rs = await Promise.all(certs.map(async (c) => { const t = performance.now(); const r = await fetch(`${base}/certificates/${c.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } }); await r.arrayBuffer(); return { ok: r.status === 200, ms: performance.now() - t }; }));
  const wall = performance.now() - t0; stop = true; await probe;
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${label.padEnd(30)} ok ${rs.filter((r) => r.ok).length}/${rs.length}  all done in ${wall.toFixed(0).padStart(6)} ms  slowest download ${ms[ms.length - 1].toFixed(0).padStart(6)} ms  /health waited at most ${worst.toFixed(0).padStart(5)} ms`);
}
await db.query(`update certificates set pdf_key = null where id = any($1::uuid[])`, [certs.map((c) => c.id)]);
for (const c of certs) rmSync(path.resolve(process.env.STORAGE_DIR ?? './storage', 'certificates', c.id), { recursive: true, force: true });
await round(`${N} downloads, none stored yet`);
await round(`${N} downloads, already stored`);
await db.end(); await app.close(); process.exit(0);
