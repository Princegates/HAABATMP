# UI structure

Layout pattern borrowed from school-management dashboards (reference screenshot supplied by HAAB):
module sidebar with expandable groups, top bar with global search, KPI tiles with progress bars, chart cards.
The visual design is HAAB's own (docs/BRAND.md). Nothing is copied from the reference product.

## Shell
- Left sidebar, dark in both themes: HAAB logo (white via filter), then module groups. Groups expand to show
  sub-pages; the active page has a gold bar. Items a role cannot use are not rendered.
- Top bar: menu toggle, current period (year) selector, global search (trainees, courses, programmes,
  certificates, organisations, instructors), notifications bell, day/night toggle, account menu.
- Content: page title in Cormorant Garamond, a one-line description, then tiles, tables and forms on `--surface`.

## Navigation (role filtered)
| Group | Pages | Roles |
|---|---|---|
| Dashboard | Overview | all (role-specific tiles) |
| Trainees | All trainees, Bulk import, Profiles | staff, auditor, org admin (own) |
| Clients | Organisations, Client dashboard | staff, auditor, finance, org admin (own) |
| Instructors | Instructors, Accreditation | staff, auditor |
| Courses | Catalogue, Categories, Modules and materials, Prerequisites | staff, instructor, auditor, trainee (active only) |
| Programmes | Programmes, Calendar, Classrooms | staff, instructor, org admin, trainee |
| Enrolments | Registrations, Waiting list | staff, org admin, trainee (own) |
| Attendance | Sessions, QR check-in, Summary | staff, instructor, trainee (check-in) |
| Assessments | Question bank, Assessments, Marking queue, Take an assessment | staff, instructor, trainee |
| Results | Results, Release | staff, instructor (read), org admin (own), trainee (own released) |
| Certificates | Issued, Expiring, Templates, Verify | staff, auditor, org admin (own), trainee (own) |
| Finance | Invoices, Payments, Outstanding | finance, staff (read), org admin (own), trainee (own) |
| Compliance | Overview, Gaps, Requirements | staff, auditor, org admin (own) |
| Documents | Library, Upload | by category and role |
| Reports | Training, Attendance, Completion, Performance, Instructor, Certificates, Financial, Compliance | by role |
| Notifications | Inbox | all |
| Audit | Audit log, Chain verification | super admin, auditor |
| Settings | Organisation, Finance, Training rules, Notifications, Certificate templates | super admin (training admin read) |

## Dashboard tiles (per SRS section 5)
Tiles show a number and a progress bar against a meaningful total, as in the reference pattern.
- Administrator: trainees, active courses, upcoming and ongoing programmes, completed, certificates issued and expiring,
  revenue and outstanding, pass rate, training hours.
- Instructor: assigned courses, upcoming classes, trainee numbers, attendance, assessments, pending marking, performance.
- Trainee: my training, upcoming classes, course progress, assessments, results, certificates, history.
- Charts: monthly activity (bars), year trend (line), breakdown by category and by client (half-donut). Chart colours come from
  a small categorical palette defined in tokens and checked in both themes.
