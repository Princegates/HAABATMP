# Build status and handoff

Work in progress on branch `claude/charming-dijkstra-6bb7fq`. The API does **not** compile or run yet.

## Decisions made
- Private internal system for HAAB (aviation consultancy). Invite-only accounts, no public sign-up.
- Stack: NestJS 11 API + Next.js (not started) + Supabase Postgres/Auth/Storage, hosted on Render.
- The API is the only gateway to the database. Row level security is enabled deny-by-default as a backstop.
- Original UI that matches HAAB's existing website (https://haabaviation.com/). No copying of third-party
  products, and no generic "AI template" look: restrained, theme-token driven styling.

## Done
- `db/migrations/0001_core.sql`: full schema, tamper-evident audit hash chain, exclusion constraints for
  instructor/room double-booking, RLS deny-by-default. Applies cleanly on Postgres 16.
- `scripts/migrate.mjs`: migration runner.
- `apps/api/src/config.ts`, `common/*`: env validation, DB service, permission matrix (7 roles), JWT
  verification (dev + Supabase), global auth guard with MFA enforcement, audit, crypto, notifications
  outbox, mailer (Resend), storage (local + Supabase), optional ClamAV scan, exception filter.

## Next (in order)
1. `common/core.module.ts`, `main.ts`, `app.module.ts`, auth controller (login, refresh, me, MFA enrol/verify).
2. Domain modules: users/orgs, courses, programmes + sessions + scheduling, enrolments, attendance
   (rotating QR), assessments + attempts + marking, results, certificates (PDF, verification),
   finance, documents, compliance, reports/exports, dashboards, audit, settings, search.
3. Seed script, scheduled jobs (`outbox`, expiry reminders, auto status changes), e2e tests including
   client-isolation checks.
4. Web UI. BLOCKED on branding: needs https://haabaviation.com/ (colors, fonts, logo, tone). The
   original session's network policy blocked that host; open this work in a new session after allowing
   the domain, then read the site first.
5. `render.yaml`, CI workflow, README, SRS traceability matrix.

## Local database (no Docker needed)
    initdb -D <dir> -A trust -U postgres && pg_ctl -D <dir> -o '-p 5433' start
    createdb atmp && psql atmp -c 'create extension btree_gist' -c 'create extension pg_trgm'
    DATABASE_URL=postgres://postgres@localhost:5433/atmp node scripts/migrate.mjs
