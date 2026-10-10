/**
 * Adds SAMPLE data so a staging site can be tried straight away: 5 trainers (instructors), 10 trainees in two sample
 * client organisations, two classrooms, and six programmes with sessions around today (one finished, one running,
 * three open for registration, one draft). The calendar, attendance, QR check-in and enrolments then have something to show.
 *
 * STAGING ONLY. Do not run on production. It refuses to run unless SAMPLE_DATA=yes is set, so it cannot happen by accident:
 *   SAMPLE_DATA=yes npm run seed-sample -w apps/api
 *
 * The sample people have no sign-in (their emails are @example.com and no invitation is sent). They exist to be scheduled,
 * registered and marked. Running it twice changes nothing. Placeholder courses that still have zero duration are given
 * realistic details and made active so programmes can open; courses HAAB has already edited are left alone.
 */
import { Client } from 'pg';
import { loadEnv } from '../config';

const TRAINERS: [string, string, string, string][] = [
  ['Kwame Boateng', 'employee', 'Safety management, audit and risk assessment', 'ICAO SMS Instructor'],
  ['Efua Mensah', 'employee', 'Aviation security and screening', 'ICAO AVSEC Instructor'],
  ['Yaw Darko', 'associate', 'Airside operations and ground handling', 'IATA Ground Ops Instructor'],
  ['Abena Owusu', 'associate', 'Emergency planning and response', 'ICAO Emergency Response Instructor'],
  ['Kojo Asante', 'employee', 'Wildlife hazard management and ARFF', 'ARFF Instructor'],
];
const ORGS: [string, string][] = [['Sample Airport Company', 'airport'], ['Sample Ground Handling Ltd', 'ground_handler']];
const TRAINEES: [string, number, string][] = [
  ['Ama Serwaa', 0, 'Safety officer'], ['Kofi Annan Jr', 0, 'Duty manager'], ['Esi Quaye', 0, 'Security screener'], ['Nii Armah', 0, 'Ramp supervisor'],
  ['Akosua Frimpong', 0, 'Terminal operations officer'], ['Selorm Agbeko', 1, 'Ramp agent'], ['Kwesi Ofori', 1, 'Loader'],
  ['Adwoa Pokuaa', 1, 'Ground operations controller'], ['Mensah Tetteh', 1, 'Baggage supervisor'], ['Naana Gyamfi', 1, 'Dispatcher'],
];
// course code, status, first-day offset from today (days), working days, room, trainees to register
const PROGRAMMES: [string, string, number, number, number, number][] = [
  ['SMS-001', 'completed', -14, 3, 0, 5],
  ['AVSEC-001', 'ongoing', -3, 4, 1, 6],
  ['GHO-001', 'open_for_registration', 2, 3, 0, 4],
  ['EPR-001', 'open_for_registration', 9, 2, 1, 3],
  ['WHM-001', 'open_for_registration', 16, 2, 0, 0],
  ['ARFF-001', 'draft', 23, 5, 1, 0],
];
const COURSE_DEFAULTS: Record<string, [number, number]> = { 'SMS-001': [24, 2200], 'AVSEC-001': [16, 1800], 'GHO-001': [24, 1500], 'EPR-001': [16, 2000], 'WHM-001': [16, 1600], 'ARFF-001': [40, 3500] };

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
/** The next `count` weekdays starting on or after `from`. */
function workdays(from: Date, count: number) {
  const out: Date[] = [];
  for (let d = from; out.length < count; d = addDays(d, 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d);
  return out;
}

async function main() {
  if (process.env.SAMPLE_DATA !== 'yes') { console.error('This adds sample data and is for staging only. Run it with SAMPLE_DATA=yes to confirm.'); process.exit(1); }
  const env = loadEnv();
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  const today = new Date(`${day(new Date())}T00:00:00Z`);
  const stat = { trainers: 0, trainees: 0, programmes: 0, sessions: 0, enrolments: 0 };

  const one = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows[0];

  // classrooms
  const rooms: string[] = [];
  for (const [name, cap] of [['Training Room A', 24], ['Training Room B', 16]] as const) {
    rooms.push((await one(`insert into classrooms (name, location, capacity) values ($1,'HAAB training centre',$2)
      on conflict (lower(name)) do update set name = classrooms.name returning id`, [name, cap])).id);
  }

  // trainers
  const trainerIds: string[] = [];
  for (let i = 0; i < TRAINERS.length; i++) {
    const [name, employment, specialties, accreditation] = TRAINERS[i];
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
    const existed = await one('select id from users where lower(email) = lower($1)', [email]);
    const u = existed ?? await one(`insert into users (email, full_name, role, status) values ($1,$2,'instructor','invited') returning id`, [email, name]);
    if (!existed) stat.trainers++;
    trainerIds.push(u.id);
    await db.query(
      `insert into instructor_profiles (user_id, employment_type, specialties, accreditation_body, accreditation_expiry, qualifications)
       values ($1,$2,$3,$4,$5,$6) on conflict (user_id) do nothing`,
      [u.id, employment, specialties, accreditation, day(addDays(today, 540)), 'Sample record']);
  }

  // clients and trainees
  const orgIds: string[] = [];
  for (const [name, type] of ORGS) {
    orgIds.push((await one(`insert into organizations (name, type, contact_email) values ($1,$2,$3)
      on conflict (lower(name)) do update set name = organizations.name returning id`, [name, type, `training@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`])).id);
  }
  const traineeIds: string[] = [];
  for (const [name, org, role] of TRAINEES) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
    const existed = await one('select id from users where lower(email) = lower($1)', [email]);
    const u = existed ?? await one(`insert into users (email, full_name, role, organization_id, status) values ($1,$2,'trainee',$3,'invited') returning id`, [email, name, orgIds[org]]);
    if (!existed) stat.trainees++;
    traineeIds.push(u.id);
    await db.query(`insert into trainee_profiles (user_id, employer, aviation_role) values ($1,$2,$3) on conflict (user_id) do nothing`, [u.id, ORGS[org][0], role]);
  }

  // programmes and sessions
  for (let n = 0; n < PROGRAMMES.length; n++) {
    const [courseCode, status, offset, days, room, enrol] = PROGRAMMES[n];
    const course = await one('select id, title, duration_hours, status, capacity, fee, currency from courses where upper(code) = upper($1)', [courseCode]);
    if (!course) { console.log(`Skipped ${courseCode}: the course is not in the catalogue. Run the catalogue seed first.`); continue; }
    if (Number(course.duration_hours) === 0 && course.status === 'draft') {
      const [hours, fee] = COURSE_DEFAULTS[courseCode];
      await db.query(`update courses set duration_hours = $2, fee = $3, validity_months = 24, status = 'active' where id = $1`, [course.id, hours, fee]);
      course.fee = fee;
    }
    const dates = workdays(addDays(today, offset), days);
    const code = `${courseCode}-${dates[0].getUTCFullYear()}-S${n + 1}`;
    const lead = trainerIds[n % trainerIds.length];
    const p = await one(
      `insert into programmes (code, course_id, title, start_date, end_date, location, classroom_id, lead_instructor_id, capacity, fee, currency, status)
       values ($1,$2,$3,$4,$5,'HAAB training centre',$6,$7,$8,$9,$10,$11) on conflict (upper(code)) do nothing returning id`,
      [code, course.id, `${course.title} (sample)`, day(dates[0]), day(dates[dates.length - 1]), rooms[room], lead, Math.max(12, course.capacity), course.fee, course.currency, status]);
    if (!p) continue; // already there from an earlier run
    stat.programmes++;
    for (let s = 0; s < dates.length; s++) {
      const d = day(dates[s]);
      await db.query(
        `insert into sessions (programme_id, title, kind, starts_at, ends_at, instructor_id, classroom_id, location)
         values ($1,$2,'class',$3,$4,$5,$6,'HAAB training centre')`,
        [p.id, `Day ${s + 1}`, `${d}T09:00:00Z`, `${d}T16:00:00Z`, lead, rooms[room]]);
      stat.sessions++;
    }
    // course teaching list: only restrict if one already exists
    const listed = await one('select count(*) n from course_instructors where course_id = $1', [course.id]);
    if (Number(listed.n) > 0) await db.query('insert into course_instructors (course_id, instructor_id) values ($1,$2) on conflict do nothing', [course.id, lead]);

    for (let t = 0; t < enrol; t++) {
      const org = TRAINEES[t][1];
      const e = status === 'completed' ? 'completed' : status === 'draft' ? 'pending' : t % 4 === 3 && status === 'open_for_registration' ? 'pending' : 'confirmed';
      const r = await db.query(
        `insert into enrollments (programme_id, trainee_id, status, sponsor_organization_id, confirmed_at) values ($1,$2,$3,$4,$5) on conflict do nothing`,
        [p.id, traineeIds[t], e, orgIds[org], e === 'pending' ? null : new Date()]);
      stat.enrolments += r.rowCount ?? 0;
    }
  }

  console.log(`Sample data ready: ${stat.trainers} trainers, ${stat.trainees} trainees, ${stat.programmes} programmes, ${stat.sessions} sessions, ${stat.enrolments} registrations added (existing ones left as they were).`);
  await db.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
