# HAAB Training Platform

Training management for **HAAB Aviation Consultancy Services Ltd.**: courses, programmes and scheduling,
registration, attendance, assessments, results, certificates with public verification, invoicing, compliance
tracking, reports and a tamper-evident audit trail. It is a private, invite-only system: nobody signs up.

Built to the SRS prepared by Anknovate IT (v1.0). `docs/SRS-TRACEABILITY.md` says, requirement by requirement,
what is built, what is partly built and what is not.

## What it does

- **Separate by organisation.** Every trainee belongs to one client organisation (or is an individual). A client's
  administrator sees only their own people, bookings, results, certificates and invoices. HAAB staff belong to HAAB,
  not to any client.
- **Seven roles**: super administrator, training administrator, instructor, trainee, client administrator,
  finance officer, auditor. Duties are deliberately split: finance cannot touch training records, training staff
  cannot record payments, auditors only read, instructors mark but cannot finalise, and the person who marked
  someone's work cannot finalise their result.
- **Certificates** carry a unique number (`ATMP-2026-SMS-000184`) and a QR code that opens a public page showing
  only validity. The QR carries an unguessable token, not the number, so certificates cannot be enumerated.
- **Super administrators manage every outside connection from the screen** (System setting > API & Integrations):
  keys are encrypted, write-only, tested with one click, audited, and other super administrators are emailed on change.
- **Day and night mode**, in HAAB's own colours and typefaces (`docs/BRAND.md`).

## Layout

```
apps/api      NestJS API. The only thing that talks to the database.
apps/web      Next.js app. Talks only to the API, through a same-origin proxy, with the session in httpOnly cookies.
db/migrations Plain SQL, applied in order by scripts/migrate.mjs.
scripts       migrate.mjs, demo.mjs (demo scenario)
docs          BRAND, UI-STRUCTURE, SRS-TRACEABILITY, DEPLOYMENT
render.yaml   Production blueprint (render.staging.yaml for a staging copy)
```

## Run it locally

Needs Node 22 and PostgreSQL 16 (or `docker compose up -d`).

```bash
cp .env.example .env            # then export it, or set the variables in your shell
npm install
npm run migrate                 # DATABASE_URL must point at an empty database
npm run build -w apps/api
npm run seed -w apps/api        # demo people and HAAB's training categories (development only)
npm run start -w apps/api       # http://localhost:4000
npm run dev:web                 # http://localhost:3000   (in a second terminal)
node scripts/demo.mjs           # optional: a full demo scenario (needs THROTTLE_DISABLED=true on the API)
```

Sign in with any seeded address, for example `superadmin@example.com`, `admin@example.com`, `instructor@example.com`,
`finance@example.com`, `auditor@example.com`, `client.admin@example.com` or `trainee1@example.com`, and the
`DEV_PASSWORD` (default `ChangeMe!2026`). Development sign-in is refused in production.

## Test

```bash
npm test -w apps/api            # 9 unit tests and 18 end-to-end tests against a real database
```

The end-to-end suite walks the whole training lifecycle and then attacks it: client isolation, segregation of
duties, certificate verification, exam timing, secrets handling, audit tampering, rate limiting and more.

## Go live

Follow `docs/DEPLOYMENT.md`. In short: a Supabase project (database, sign-in, private file bucket), Render for the
API, web app and the 15-minute housekeeping job, your GoDaddy domain pointed at it, and one command to create the
first super administrator.

## Known limits

See the end of `docs/SRS-TRACEABILITY.md`. The important ones: Supabase sign-in and second-factor flows are written
but have not been exercised against a live Supabase project; the HAAB logo file must be added; SCORM playback, SMS,
WhatsApp, online card payments and the AI features are not built.
