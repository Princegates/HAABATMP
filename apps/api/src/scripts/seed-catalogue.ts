/**
 * Adds HAAB's training categories and one draft placeholder course per offering. Safe on any environment, including
 * production: it creates no people, no passwords and no demo data, and running it twice changes nothing.
 * Courses are drafts with zero duration and fee. HAAB sets the real details before activating them.
 */
import { Client } from 'pg';
import { loadEnv } from '../config';

const catalogue: [string, string, string, string[]][] = [
  ['SMS', 'Safety Management Systems', 'Building and running a safety management system for an aerodrome or aviation organisation.', ['Airport Safety Management Systems (SMS)']],
  ['EPR', 'Emergency Planning and Response', 'Planning, exercising and managing emergencies at airports.', ['Airport Emergency Planning and Response']],
  ['ASO', 'Airside Operations', 'Safe and efficient operation of the airside.', ['Airside Operations and Management']],
  ['GHO', 'Ground Handling Operations', 'Aircraft ground handling procedures and safety.', ['Ground Handling Operations']],
  ['AVSEC', 'Aviation Security', 'Aviation security in line with ICAO Annex 17.', ['Security Screening (ICAO Annex 17)', 'AVSEC Training']],
  ['CERT', 'ICAO and ACI Certification Preparation', 'Preparing airports for ICAO and ACI certification.', ['ICAO and ACI Certification Preparation']],
  ['ARFF', 'Aerodrome Rescue and Fire Fighting', 'Rescue and fire fighting at aerodromes.', ['ARFF Training']],
  ['WHM', 'Wildlife Hazard Management', 'Managing wildlife hazards at and around airports.', ['Wildlife Hazard Management']],
];

async function main() {
  const env = loadEnv();
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  let categories = 0, courses = 0;
  for (const [code, name, description, titles] of catalogue) {
    const c = await db.query(
      `insert into course_categories (code, name, description) values ($1,$2,$3)
       on conflict (code) do update set description = coalesce(course_categories.description, excluded.description) returning id, (xmax = 0) as inserted`,
      [code, name, description]);
    if (c.rows[0].inserted) categories++;
    let i = 1;
    for (const title of titles) {
      const r = await db.query(
        `insert into courses (code, title, category_id, description, status, duration_hours, fee)
         values ($1,$2,$3,$4,'draft',0,0) on conflict (upper(code)) do nothing returning id`,
        [`${code}-${String(i++).padStart(3, '0')}`, title, c.rows[0].id, 'Placeholder from the HAAB website. Set duration, fee, validity and approval details before activating.']);
      courses += r.rowCount ?? 0;
    }
  }
  console.log(`Catalogue ready: ${categories} categories and ${courses} draft courses added (existing ones left as they were).`);
  await db.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
