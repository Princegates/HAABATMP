/**
 * Clears the platform back to an empty, ready-to-use state, keeping only the Super Administrator account(s).
 *
 * DESTRUCTIVE AND NOT REVERSIBLE (apart from restoring a database backup). It is never run by anything automatic.
 *
 *   npm run reset-data -w apps/api                    shows what would be removed and stops
 *   RESET_DATA=yes npm run reset-data -w apps/api     removes it
 *
 * Removed: every other user and their sign-in, clients, programmes, sessions, registrations, attendance, assessments and
 * attempts, results, certificates, invoices and payments, uploaded documents and course material, question bank,
 * notifications and sign-up requests. Numbering (certificates, invoices, receipts) starts again.
 *
 * Kept: the Super Administrator account(s), the system settings and integrations (so email, branding and keys still work),
 * certificate templates, and the course catalogue (categories and courses, without their modules and questions).
 * Options:
 *   WIPE_CATALOGUE=yes   also removes categories and courses
 *   WIPE_AUDIT=yes       also clears the audit log (it is normally append-only; this restarts the chain with one entry saying so)
 */
import { Client } from 'pg';
import { loadEnv } from '../config';
import { StorageService } from '../common/storage.service';
import { serviceHeaders } from '../common/supabase';

const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;

async function main() {
  const env = loadEnv();
  const apply = process.env.RESET_DATA === 'yes';
  const wipeCatalogue = process.env.WIPE_CATALOGUE === 'yes';
  const wipeAudit = process.env.WIPE_AUDIT === 'yes';
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  try {
    const supers = (await db.query(`select id, email, auth_user_id from users where role = 'super_admin' order by created_at`)).rows;
    if (!supers.length) throw new Error('There is no Super Administrator account, so nothing would be left to sign in with. Stopping.');

    // tables cleared completely (listed together so the database refuses if anything kept still points at them)
    const wipe = ['notifications', 'registration_requests', 'material_progress', 'attempt_answers', 'exam_attempts', 'assessment_questions', 'assessments',
      'questions', 'result_changes', 'results', 'attendance', 'sessions', 'payments', 'invoice_items', 'invoices', 'certificates', 'compliance_requirements',
      'enrollments', 'programmes', 'learning_materials', 'course_modules', 'course_instructors', 'documents', 'classrooms',
      'trainee_profiles', 'certificate_sequences', 'invoice_sequences', 'receipt_sequences'];
    if (wipeCatalogue) wipe.push('course_prerequisites', 'courses', 'course_categories');
    if (wipeAudit) wipe.push('audit_logs');

    const count = async (sql: string) => Number((await db.query(sql)).rows[0].n);
    const others = await count(`select count(*) n from users where role <> 'super_admin'`);
    const orgs = await count('select count(*) n from organizations');
    const lines: [string, number][] = [['other users', others], ['clients', orgs]];
    for (const t of wipe) lines.push([t.replace(/_/g, ' '), await count(`select count(*) n from ${quote(t)}`)]);
    console.log(`Database: ${new URL(env.DATABASE_URL).host}${new URL(env.DATABASE_URL).pathname}`);
    console.log(`Keeping ${supers.length} Super Administrator account${supers.length === 1 ? '' : 's'}: ${supers.map((s: any) => s.email).join(', ')}`);
    console.log(`Keeping settings, integrations, certificate templates${wipeCatalogue ? '' : ', and the course catalogue'}${wipeAudit ? '' : ', and the audit log'}.`);
    console.log('Would remove:'); for (const [n, c] of lines) if (c) console.log(`  ${String(c).padStart(6)}  ${n}`);
    if (!apply) { console.log('\nNothing was changed. To go ahead run it again with RESET_DATA=yes.'); return; }

    // uploaded files first, so none are left behind in storage
    const keys = (await db.query<{ storage_key: string }>('select storage_key from documents')).rows.map((r) => r.storage_key);
    const storage = new StorageService(env as any);
    let filesGone = 0;
    for (const k of keys) { try { await storage.remove(k); filesGone++; } catch { /* already gone */ } }

    const gone = await db.query<{ auth_user_id: string | null }>(`select auth_user_id from users where role <> 'super_admin' and auth_user_id is not null`);
    await db.query('begin');
    try {
      if (wipeAudit) for (const t of ['audit_logs_chain', 'audit_logs_no_update', 'audit_logs_no_truncate']) await db.query(`alter table audit_logs disable trigger ${t}`);
      // anything kept that points at a person or client being removed is detached (soft pointers only; a hard one stops the reset)
      const superIds = supers.map((s: any) => s.id);
      const fks = (await db.query<{ tbl: string; col: string; target: string; nn: boolean }>(
        `select c.conrelid::regclass::text tbl, a.attname col, c.confrelid::regclass::text target, a.attnotnull as nn
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
          where c.contype = 'f' and c.confrelid in ('users'::regclass, 'organizations'::regclass)`)).rows;
      const stay = (t: string) => !wipe.includes(t.replace(/"/g, '')) && t !== 'users' && t !== 'organizations';
      for (const f of fks.filter((x) => stay(x.tbl) && x.target === 'users' && !x.nn)) await db.query(`update ${f.tbl} set ${quote(f.col)} = null where ${quote(f.col)} is not null and not (${quote(f.col)} = any($1))`, [superIds]);
      for (const f of fks.filter((x) => stay(x.tbl) && x.target === 'organizations' && !x.nn)) await db.query(`update ${f.tbl} set ${quote(f.col)} = null where ${quote(f.col)} is not null`);
      await db.query(`update users set organization_id = null, created_by = null where role = 'super_admin'`);
      await db.query('delete from certificate_templates where organization_id is not null and not is_default');

      await db.query(`truncate table ${wipe.map(quote).join(', ')}`);
      await db.query(`delete from instructor_profiles where user_id <> all($1)`, [superIds]);
      await db.query(`delete from users where role <> 'super_admin'`);
      await db.query('delete from organizations');
      const row = await db.query(`insert into audit_logs (actor_email, actor_role, action, entity_type, after_data) values ('reset-data', 'system', 'system.reset_data', 'system', $1) returning id`,
        [JSON.stringify({ kept_super_admins: supers.map((s: any) => s.email), catalogue_wiped: wipeCatalogue, audit_wiped: wipeAudit, users_removed: others, files_removed: filesGone })]);
      if (wipeAudit) for (const t of ['audit_logs_chain', 'audit_logs_no_update', 'audit_logs_no_truncate']) await db.query(`alter table audit_logs enable trigger ${t}`);
      void row;
      await db.query('commit');
    } catch (e) { await db.query('rollback'); throw e; }

    // sign-ins in Supabase last, so a failed reset never locks anyone out
    let signIns = 0;
    if (env.AUTH_MODE === 'supabase') {
      for (const g of gone.rows) {
        try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${g.auth_user_id}`, { method: 'DELETE', headers: serviceHeaders(env.SUPABASE_SERVICE_ROLE_KEY) }); if (r.ok) signIns++; } catch { /* leave it */ }
      }
    }
    console.log(`\nDone. Removed ${others} users${env.AUTH_MODE === 'supabase' ? ` (${signIns} sign-ins)` : ''}, ${orgs} clients and ${filesGone} uploaded files. The Super Administrator account${supers.length === 1 ? ' is' : 's are'} untouched.`);
  } finally { await db.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
