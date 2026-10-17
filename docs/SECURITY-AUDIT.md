# Security audit: HAAB Training Management Platform

**Scope:** white-box review of the API (NestJS), the web app and proxy (Next.js), the database migrations and the Render/Supabase configuration, plus live probing of the web proxy and a timing run of the file parsers. Three independent reviews covered (1) authentication, authorisation and tenant isolation, (2) training-workflow integrity and file parsing, (3) files, money, outputs, the web client and deployment. Every finding below was checked in the code before it was fixed.

**What this is not:** an external penetration test. Before real personal records are loaded, commission an independent test and a data-protection review.

Result: **no critical findings**. Authorisation, SQL handling (every value is a bound parameter), file storage keys, downloads, email, cookies, and the audit log all held up. The items below were fixed in this branch and are covered by automated tests (`apps/api/test/e2e.test.mjs`, tests 24 to 28).

## Fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium-high | The attendance roster returned the permanent QR secret, so an auditor or instructor could compute valid check-in codes for absent trainees. | Secret removed from responses; every existing secret rotated (migration 0008). A scan no longer overwrites a mark staff entered by hand. |
| 2 | Medium | A web visitor could send any `cf-connecting-ip` and dodge the login, registration and reset rate limits, and forge the audit-log address. | That header is only trusted when `TRUST_CLOUDFLARE=true` is set on the host. |
| 3 | Medium | A PATCH sending one field silently reset the others to defaults (a client became active again; a course lost its fee, pass mark and status). | New `patchOf` helper; used on every update that has defaults. |
| 4 | Medium | Decompression bombs and quadratic parsing in the Word and Excel importers could exhaust memory or block the server for every user. | Zip table-of-contents guard before inflating, size and part limits, linear-time parsing, uploads limited while received. |
| 5 | Medium | Instructors could read or change any course's question bank, including answers, and edit questions already in a published assessment. | Instructors are limited to courses they are listed for or teach; questions in published assessments are frozen. |
| 6 | Medium | Instructors could create trainee accounts and send invitations in any client, and probe which emails have accounts. | Instructors must name a programme they teach and learn nothing about accounts outside the chosen client. Bulk import throttled. |
| 7 | Medium | A result could be overridden by the person who marked the work. | Maker-checker now applies to overrides, and to attendance-only programmes. The super-admin exemption on overrides was removed. |
| 8 | Medium | Learning links accepted `javascript:` and `data:` URLs (script runs when clicked). | Only http(s) links accepted and rendered; existing bad links removed (migration 0009). |
| 9 | Low-medium | Reissuing a certificate renewed its validity, even for expired ones or non-passes. | A reissue keeps the original dates and is refused for expired certificates or results that are not a pass. |
| 10 | Low-medium | Marks could change after a result was finalised, and a background sweep could re-grade an attempt a marker had just finished. | Marks sealed once finalised (use an audited override); the sweep re-checks under a lock. Only published assessments can be closed. |
| 11 | Low-medium | Open redirect after sign-in (`/login?next=/\evil.example`). | Redirect targets must resolve to this site. |
| 12 | Low-medium | Sign-in endpoints could be reached through the web proxy by changing letter case (`AUTH/login`). | Case-insensitive block; only plain path segments are forwarded. |
| 13 | Low-medium | Insecure development defaults could run if a hosted service was started without `NODE_ENV`. | Dev sign-in is refused unless the database is on the same machine; an encryption key is required with Supabase sign-in. |
| 14 | Low | Learning materials readable by anyone who could read a course; client administrators saw every client's compliance requirements. | Materials limited to staff, auditors, instructors and enrolled trainees; requirements scoped to the client. A client administrator without an organisation can no longer see everything. |
| 15 | Low | Training admins could delete financial documents; revoked certificates could be downloaded by trainees. | Financial documents are super-admin only to delete; revoked certificates are not handed to trainees. |
| 16 | Low | Money accepted more than two decimals (stored amounts could differ from totals); database constraint names appeared in errors; registration names could carry links into staff emails. | Two-decimal limit; constraint names removed; names collapsed to one plain line without links. |
| 17 | Low | Exam answers had no size limit; zero-value marks caused a server error; local Postgres published on all interfaces; CI token had write scope. | Answer size cap; minimum mark 0.01; Postgres bound to localhost; read-only CI token. |

## Hardening round 2 (low-risk)

| Change | Why |
|---|---|
| Supabase tokens are checked against this project's issuer (`<SUPABASE_URL>/auth/v1`, or `SUPABASE_JWT_ISSUER` for a custom auth domain). It starts in `warn` mode (logs a mismatch, lets the request through); set `SUPABASE_JWT_ISSUER_MODE=enforce` once the logs show no warnings. | In enforce mode a token from another project that shares the signing method is refused. |
| Rate limits count per signed-in person; unauthenticated requests are still counted by address. | People sharing one address (a classroom) no longer lock each other out of an exam. A made-up token falls back to the address. |
| The signed-in person is remembered for 10 seconds, and cleared at once on any change to a user (role, status, two-step sign-in, deletion). | Removes a database read from every request. On a second server instance a suspension takes up to 10 seconds to be seen. |
| Sign-in: the per-address limit is 60 a minute (was 8), and wrong passwords are limited per account instead: 5 in 10 minutes pauses that person on that address, 30 from anywhere pauses the email. Pauses are audited (`auth.login_paused`). The counts live in one server's memory. | A whole class can sign in from one address, while guessing at one account is still stopped. A stranger cannot cheaply lock someone out, because the 5-attempt pause only applies to their own address. |
| Dependabot, CodeQL and a committed-secret check in CI. | Out-of-date packages, code-level bugs and leaked keys are caught before release. |

## Accepted or open (decide and schedule)

| Item | Why it is open | Recommendation |
|---|---|---|
| Content-Security-Policy allows inline scripts (`script-src 'unsafe-inline'`). | Next.js needs it without a nonce setup. Other layers (httpOnly cookies, no HTML rendering of user text, http(s)-only links) limit the impact. | Move to nonce-based CSP. |
| The virus-scan hook does nothing until ClamAV is configured. | Uploads are accepted unscanned when no scanner is set, so the promise depends on setup. | Run ClamAV, or restrict uploads until it is. |
| Database connections do not verify the server certificate. | Needs the provider's CA bundle. | Add Supabase's CA and set `rejectUnauthorized: true`. |
| The audit hash chain is unkeyed. | Someone with database-owner rights could rewrite and re-hash it. | Use an HMAC key held outside the database, export the head hash regularly, and run the API as a non-owner database role. |
| Cloudflare is not in front yet. | The origin lock (`ORIGIN_LOCK_SECRET`) and `TRUST_CLOUDFLARE` are built but off, so the app's own address is reachable without a firewall. | Follow `docs/CLOUDFLARE.md` to switch them on. |
| The API is a public Render service. | The web proxy is the only intended client. | Make it a private service reachable only from the web app. |
| `POST /auth/set-password` accepts a first-factor session for a user who has two-step sign-in. | A reset link normally carries a first-factor session. Requiring the second factor could lock out people who lost their password. | Decide the recovery policy with Supabase's secure password change setting. |
| Client administrators can read every non-private document of their own trainees, including ones marked confidential. | Scoped to their own organisation, so not cross-tenant. | Decide whether confidential documents should be hidden from employers. |
| Finance officers can change tax, currency and `require payment before confirmation`. | By design (Payment Methods and Currency pages), but it affects enrolment. | Make these settings super-admin only if finance must not influence enrolment. |
| QR check-in is not bound to a trainee or location. | A trainee can pass a code to an absent friend within 30 to 60 seconds. | Add a location check or one-time codes if attendance fraud is a concern. |
| Smaller items: per-question marks shown after release when several attempts are allowed; password-reset timing difference; no per-account failed-login counter beyond the rate limit; a possible waiting-list timing race that cannot overbook. | Low impact. | Schedule with the next release. |

## Operating notes

- Keep `TRUST_CLOUDFLARE` unset unless every request really arrives through Cloudflare.
- Keep `DATA_ENCRYPTION_KEY` backed up. Rotate `PROXY_SHARED_SECRET` and the Supabase keys if you ever suspect exposure.
- Run `npm audit` on every release (currently 0 known vulnerabilities).
