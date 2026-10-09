/**
 * Creates the first super administrator on a new deployment, because nobody can sign up and nobody exists yet to invite them.
 *   npm run create-super-admin -w apps/api -- you@haab.example "Your Name"
 * In Supabase mode it also sends the invitation email. Refuses to run if a super administrator already exists.
 */
import { Client } from 'pg';
import { loadEnv } from '../config';

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
    console.error('Usage: npm run create-super-admin -w apps/api -- <email> "<full name>"');
    process.exit(1);
  }
  const env = loadEnv();
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  try {
    const existing = await db.query(`select 1 from users where role = 'super_admin' limit 1`);
    if (existing.rowCount) throw new Error('A super administrator already exists. Ask them to create more from the Users screen.');
    let authUserId: string | null = null;
    if (env.AUTH_MODE === 'supabase') {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(`${env.PUBLIC_WEB_URL}/set-password`)}`, {
        method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`The invitation could not be sent (${res.status}). Check the Supabase keys.`);
      authUserId = ((await res.json()) as any).id ?? null;
    }
    const r = await db.query(`insert into users (email, full_name, role, status, auth_user_id) values ($1,$2,'super_admin','invited',$3) returning id`, [email, name, authUserId]);
    await db.query(`insert into audit_logs (actor_email, actor_role, action, entity_type, entity_id, after_data) values ('bootstrap', 'system', 'user.create_first_super_admin', 'user', $1, $2)`, [r.rows[0].id, JSON.stringify({ email })]);
    console.log(env.AUTH_MODE === 'supabase' ? `Invitation sent to ${email}. Open it, set a password, then enrol an authenticator app when asked.` : `Created ${email}. Sign in with the development password.`);
  } finally { await db.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
