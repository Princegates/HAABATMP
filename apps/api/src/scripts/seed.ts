/**
 * Development seed: demo people and HAAB's training categories. Refuses to run in production.
 * Every account is created active with the shared DEV_PASSWORD. Courses are drafts with placeholder values:
 * HAAB must set duration, fees, validity and approval details before publishing.
 */
import { Client } from 'pg';
import { loadEnv } from '../config';

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  if (env.AUTH_MODE !== 'dev') throw new Error('Seeding creates dev-mode accounts; set AUTH_MODE=dev');
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
  await db.connect();

  const orgs = [
    ['Demo Airport Company', 'airport'],
    ['Demo Ground Handling Ltd', 'ground_handler'],
  ];
  const orgIds: Record<string, string> = {};
  for (const [name, type] of orgs) {
    const r = await db.query(
      `insert into organizations (name, type, contact_email) values ($1,$2,$3) on conflict (lower(name)) do update set type = excluded.type returning id`,
      [name, type, `contact@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`]);
    orgIds[name] = r.rows[0].id;
  }

  const people: [string, string, string, string | null][] = [
    ['superadmin@example.com', 'Super Administrator', 'super_admin', null],
    ['admin@example.com', 'Training Administrator', 'training_admin', null],
    ['admin2@example.com', 'Second Training Administrator', 'training_admin', null],
    ['instructor@example.com', 'Demo Instructor', 'instructor', null],
    ['finance@example.com', 'Finance Officer', 'finance_officer', null],
    ['auditor@example.com', 'Compliance Auditor', 'auditor', null],
    ['client.admin@example.com', 'Airport Client Administrator', 'org_admin', 'Demo Airport Company'],
    ['trainee1@example.com', 'Ama Mensah', 'trainee', 'Demo Airport Company'],
    ['trainee2@example.com', 'Kofi Boateng', 'trainee', 'Demo Airport Company'],
    ['trainee3@example.com', 'Esi Owusu', 'trainee', 'Demo Ground Handling Ltd'],
    ['trainee4@example.com', 'Yaw Asante', 'trainee', 'Demo Airport Company'],
    ['trainee5@example.com', 'Abena Kyei', 'trainee', 'Demo Ground Handling Ltd'],
    ['trainee6@example.com', 'Nana Quaye', 'trainee', null],
    ['client.admin2@example.com', 'Ground Handling Client Administrator', 'org_admin', 'Demo Ground Handling Ltd'],
  ];
  for (const [email, name, role, org] of people) {
    const r = await db.query(
      `insert into users (email, full_name, role, organization_id, status) values ($1,$2,$3,$4,'active') on conflict (lower(email)) do nothing returning id`,
      [email, name, role, org ? orgIds[org] : null]);
    const id = r.rows[0]?.id ?? (await db.query('select id from users where lower(email) = $1', [email])).rows[0].id;
    if (role === 'trainee') await db.query('insert into trainee_profiles (user_id) values ($1) on conflict do nothing', [id]);
    if (role === 'instructor') await db.query(`insert into instructor_profiles (user_id, employment_type) values ($1,'associate') on conflict do nothing`, [id]);
  }

  // Training and Capacity Building offer, as listed on haabaviation.com
  const catalogue: [string, string, string[]][] = [
    ['SMS', 'Safety Management Systems', ['Airport Safety Management Systems (SMS)']],
    ['EPR', 'Emergency Planning and Response', ['Airport Emergency Planning and Response']],
    ['ASO', 'Airside Operations', ['Airside Operations and Management']],
    ['GHO', 'Ground Handling Operations', ['Ground Handling Operations']],
    ['AVSEC', 'Aviation Security', ['Security Screening (ICAO Annex 17)', 'AVSEC Training']],
    ['CERT', 'ICAO and ACI Certification Preparation', ['ICAO and ACI Certification Preparation']],
    ['ARFF', 'Aerodrome Rescue and Fire Fighting', ['ARFF Training']],
    ['WHM', 'Wildlife Hazard Management', ['Wildlife Hazard Management']],
  ];
  for (const [code, name, courses] of catalogue) {
    const c = await db.query(`insert into course_categories (code, name) values ($1,$2) on conflict (code) do update set name = excluded.name returning id`, [code, name]);
    let i = 1;
    for (const title of courses) {
      await db.query(
        `insert into courses (code, title, category_id, description, status, duration_hours, fee)
         values ($1,$2,$3,$4,'draft',0,0) on conflict (upper(code)) do nothing`,
        [`${code}-${String(i++).padStart(3, '0')}`, title, c.rows[0].id, 'Placeholder from the HAAB website. Set duration, fee, validity and approval details before activating.']);
    }
  }
  await db.query(`insert into classrooms (name, location, capacity) values ('Training Room 1','Head office',20) on conflict do nothing`);
  console.log('Seed complete. Sign in with any seeded email and the DEV_PASSWORD.');
  await db.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
