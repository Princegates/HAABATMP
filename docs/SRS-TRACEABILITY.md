# SRS status, requirement by requirement

Source: Aviation Training Management Platform SRS v1.0 (Anknovate IT, October 2026).
Key: **Done** = built and covered by the automated tests. **Partly** = built with the gap stated. **Not built** = left out on purpose or not yet.
"Tested live" is called out where something could only be checked against a real outside service, which this build environment cannot reach.

## 4. Functional requirements

| SRS | Requirement | Status | Notes |
|---|---|---|---|
| 4.1 | Register, log in, reset/change password, profile | **Partly** | Accounts are **invited, not self-registered** (a deliberate change for a private system). Sign-in, session cookies, logout, set-password from an emailed link, forgotten-password request and admin-triggered reset are built. Supabase flows (invitation, reset, MFA) are written to Supabase's documented API but **not tested against a live project**. Changing your own password while signed in is not built yet (use the reset link). |
| 4.1 | Email verification; optional MFA | **Done** | Invitation confirms the address. Two-step sign-in (authenticator app) is **optional and off by default**. Anyone can turn it on from My profile, and the Super Admin can require it for chosen roles under Security Setting. Anyone who has turned it on must use it at every sign-in. |
| 4.1 | Future SSO / Google / Microsoft | **Not built** | Listed under API & Integrations as planned. |
| 4.2 | Trainee profiles, history, search, filter, update | **Done** | Includes bulk CSV import, duplicate-name warnings, ID numbers encrypted and masked, trainees grouped by organisation. |
| 4.3 | Organisation profiles, contacts, employees, billing, dashboards | **Done** | Client isolation tested end to end. |
| 4.4 | Course management and categories | **Done** | Categories pre-loaded from HAAB's published training services; courses seeded as drafts with placeholder values to be completed by HAAB. |
| 4.5 | Programmes and the six statuses | **Done** | Legal status transitions enforced; cancelling cascades to registrations and unpaid invoices. |
| 4.6 | Calendar scheduling, conflict detection, views | **Partly** | Conflicts for instructor, classroom and programme are blocked in the application and again by the database. The calendar is a **week view** with instructor and classroom filters; day and month views are not built. |
| 4.7 | Learning content, progress | **Partly** | Modules and materials by link with required/optional and Not started / In progress / Completed progress. **No hosted video or document library and no SCORM player.** |
| 4.8 | Attendance (Present, Absent, Late, Excused), QR, location | **Partly** | Manual and rotating QR (30-second code, link-based). GPS position is recorded when a trainee allows it, but **location is not validated** against the venue. |
| 4.9 | Assessments, question bank, configuration | **Done** | All seven question types, banks by course/topic/difficulty/type, duration, pass mark, shuffling of question order, attempts, automatic submission, result release. Answer **options** are not shuffled. |
| 4.10 | Results and statuses | **Done** | Decided by a tested rule (attendance and every assessment). Two-person control on finalising and overriding. |
| 4.11 | Certificates | **Partly** | Automatic generation, unique number in the SRS format, QR, template with signatory name/title and accent colour, PDF. **No handwritten-signature image.** The HAAB logo prints on every certificate. |
| 4.12 | Certificate verification | **Done** | Public page by unguessable token; Valid / Expiring soon / Expired / Revoked. |
| 4.13 | Payments and billing | **Partly** | Invoices, partial payments, receipts, refunds, all six statuses, PDFs. **No online gateway** (Paystack/Hubtel/Flutterwave), by decision; payments are recorded by Finance. Credential slots exist for later. |
| 4.14 | Notifications | **Partly** | In-app and email (queued, retried, not duplicated). Reminders for classes and certificate expiry. **SMS and WhatsApp not built.** Email wording is built in, not yet editable. |
| 4.15 | Document management | **Done** | Type checked by content, size limit, private storage, role-based access, downloads of confidential files audited. Virus scanning works when a ClamAV service is connected; none is bundled. |
| 4.16 | Training compliance | **Done** | Requirements by course, client and aviation role, grace periods, missing / expiring / expired, failed assessments, attendance shortfalls. |
| 4.17 | Reports and export (PDF, Excel, CSV) | **Done** | Nine reports. Exports are audited. |
| 4.18 | Search and filtering | **Done** | Global search scoped to what each role may see; filters on every list. |
| 4.19 | Audit trail | **Done** | User, action, time, IP address, record, before/after. Append-only and hash-chained; tampering is detected (tested). |

## 5. Dashboards
Administrator, Instructor and Trainee **Done**. Client administrator, Finance and Auditor dashboards added (the SRS defined roles for them but no dashboard).

## 6. Security
| Requirement | Status |
|---|---|
| Password hashing, session management | **Done** by Supabase Auth; sessions in httpOnly cookies, tokens never reach page scripts |
| RBAC | **Done**, seven roles, tested |
| HTTPS | **Done** by the host; HSTS and security headers set |
| Encryption of sensitive data at rest | **Done** for ID numbers and stored integration keys (AES-256-GCM); database and storage encrypted by Supabase |
| SQL injection, XSS, CSRF, brute force, session hijacking | **Done**: parameterised queries, no raw HTML, same-origin checks, rate limiting, per-client addresses; **a penetration test is still required before go-live** |
| File-upload validation and malware protection | **Done**; scanning needs ClamAV connected |
| Audit logging | **Done** |
| Backups and disaster recovery | **Not in the application**: provided by Supabase point-in-time recovery; the platform records restore drills |

## 7–10. Backup, architecture, stack, non-functional
Architecture and stack follow the SRS (API-driven, PostgreSQL, Next.js/NestJS). Performance, availability and scale targets are **not load-tested**. Accessibility: labelled forms, keyboard focus, contrast-checked colours in both themes, reduced-motion respected; **no formal WCAG audit**. Fully responsive layout, but an installable app (PWA) and offline use are **not built**.

## 11–15. Data, workflows, settings, certificate design
All core entities and both workflows (individual and corporate) are implemented. Administrative settings follow the "System setting" pages: organisation, period, training rules, notifications, email, payment methods, currency, print header/footer, modules, file types, backup, roles (read-only). Languages, SMS, WhatsApp and captcha are listed as **planned**.

## 16–17. Future AI and integrations
**Not built.** Microsoft 365/Google, Zoom/Teams, SMS/WhatsApp, payment gateways, HR and aviation systems have credential slots under API & Integrations so they can be stored ahead of the phase that uses them.

## 18–20. Roadmap, acceptance criteria, success metrics
Phase 1 is complete apart from the items marked Partly above. The corporate (client) portal from Phase 2 is built. Acceptance criteria in section 19 are covered by the end-to-end suite, except "operates effectively across desktop and mobile" (responsive layout built, not device-tested) and "data is securely stored and backed up" (depends on hosting set-up). Success metrics need baselines and targets from HAAB before they can be measured.

## Decisions that differ from, or add to, the SRS
- Private, invitation-only platform; no public registration; public certificate verification shows only validity.
- Trainees belong to one client organisation or none; HAAB staff belong to HAAB only (enforced in the database).
- Stronger controls than written: two-person control on results, tamper-evident audit log.
- Super administrators manage every outside credential in the application (encrypted, write-only, audited).
- Day and night modes in HAAB's colours.

## Known limits and things to do before relying on it
1. Test the Supabase invitation, reset and MFA flows on a staging project. They follow Supabase's documented API but could not be run here.
2. Independent penetration test; Ghana Data Protection Act review (retention, erasure, hosting abroad).
3. HAAB to replace the placeholder course values and confirm which authority recognises each course.
4. Changing your own password while signed in, day/month calendar views, editable email templates, option shuffling, signature images, SCORM, SMS, WhatsApp, online payments and AI features are not built.
