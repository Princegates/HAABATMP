-- HAAB staff (administrators, instructors, finance, auditors) belong to HAAB, not to a client.
-- Only trainees and client administrators are attached to a client organisation.
update users set organization_id = null where role not in ('trainee', 'org_admin') and organization_id is not null;
alter table users add constraint staff_have_no_organisation check (role in ('trainee', 'org_admin') or organization_id is null);
