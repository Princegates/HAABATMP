-- HAAB Aviation Training Management Platform: core schema
-- All access goes through the API. Row level security is enabled with no
-- policies, so the Supabase auto-generated REST API exposes nothing.

create extension if not exists btree_gist;
create extension if not exists pg_trgm;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- identity

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'other'
    check (type in ('airline','airport','ground_handler','cargo_operator','security_organization','other')),
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  billing_email text,
  billing_address text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_name_key on organizations (lower(name));

create table users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null,
  full_name text not null,
  phone text,
  role text not null
    check (role in ('super_admin','training_admin','instructor','trainee','org_admin','finance_officer','auditor')),
  organization_id uuid references organizations(id),
  status text not null default 'invited' check (status in ('invited','active','suspended')),
  last_login_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- trainees and org admins always belong to an organization or are individuals (null);
  -- org_admin must have an organization
  constraint org_admin_has_org check (role <> 'org_admin' or organization_id is not null)
);
create unique index users_email_key on users (lower(email));
create index users_org_idx on users (organization_id);
create index users_role_idx on users (role);
create index users_name_trgm on users using gin (full_name gin_trgm_ops);

create table trainee_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  employer text,
  aviation_role text,
  licence_number text,
  licence_expiry date,
  nationality text,
  date_of_birth date,
  id_type text,
  id_number_enc text,         -- AES-256-GCM, see api/src/common/crypto.ts
  qualifications text,
  emergency_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table instructor_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  employment_type text not null default 'associate' check (employment_type in ('employee','associate')),
  qualifications text,
  specialties text,
  accreditation_body text,
  accreditation_expiry date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- courses

create table course_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,                    -- three to five letters, used in certificate numbers
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  constraint category_code_format check (code ~ '^[A-Z]{2,5}$')
);
create unique index course_categories_code_key on course_categories (code);
create unique index course_categories_name_key on course_categories (lower(name));

create table courses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  category_id uuid not null references course_categories(id),
  description text,
  objectives text,
  duration_hours numeric(6,1) not null default 0 check (duration_hours >= 0),
  delivery_method text not null default 'classroom'
    check (delivery_method in ('classroom','online','blended','practical')),
  target_audience text,
  capacity integer not null default 20 check (capacity > 0),
  fee numeric(12,2) not null default 0 check (fee >= 0),
  currency text not null default 'GHS',
  pass_mark integer not null default 70 check (pass_mark between 0 and 100),
  min_attendance_pct integer not null default 80 check (min_attendance_pct between 0 and 100),
  validity_months integer check (validity_months is null or validity_months > 0),
  approving_body text,
  approval_reference text,
  approval_expiry date,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index courses_code_key on courses (upper(code));
create index courses_category_idx on courses (category_id);
create index courses_title_trgm on courses using gin (title gin_trgm_ops);

create table course_prerequisites (
  course_id uuid not null references courses(id) on delete cascade,
  prerequisite_id uuid not null references courses(id),
  primary key (course_id, prerequisite_id),
  check (course_id <> prerequisite_id)
);

create table course_instructors (
  course_id uuid not null references courses(id) on delete cascade,
  instructor_id uuid not null references users(id),
  primary key (course_id, instructor_id)
);

create table course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index course_modules_course_idx on course_modules (course_id, position);

create table documents (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'other'
    check (category in ('identification','certificate','licence','training_record','course_material',
                        'attendance','examination','instructor_qualification','financial','other')),
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  storage_key text not null,
  owner_user_id uuid references users(id),
  organization_id uuid references organizations(id),
  confidential boolean not null default true,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index documents_owner_idx on documents (owner_user_id);
create index documents_org_idx on documents (organization_id);

create table learning_materials (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_modules(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('video','pdf','presentation','document','audio','image','scorm','link')),
  url text,
  document_id uuid references documents(id),
  required boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (url is not null or document_id is not null)
);
create index learning_materials_module_idx on learning_materials (module_id, position);

create table material_progress (
  trainee_id uuid not null references users(id) on delete cascade,
  material_id uuid not null references learning_materials(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  updated_at timestamptz not null default now(),
  primary key (trainee_id, material_id)
);

-- ---------------------------------------------------------------- programmes and scheduling

create table classrooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  capacity integer not null default 20 check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index classrooms_name_key on classrooms (lower(name));

create table programmes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  course_id uuid not null references courses(id),
  title text not null,
  start_date date not null,
  end_date date not null,
  location text,
  classroom_id uuid references classrooms(id),
  delivery_method text not null default 'classroom'
    check (delivery_method in ('classroom','online','blended','practical')),
  lead_instructor_id uuid references users(id),
  capacity integer not null check (capacity > 0),
  registration_deadline date,
  fee numeric(12,2) not null default 0 check (fee >= 0),
  currency text not null default 'GHS',
  -- set for closed programmes run for one client organisation
  organization_id uuid references organizations(id),
  status text not null default 'draft'
    check (status in ('draft','open_for_registration','registration_closed','ongoing','completed','cancelled')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create unique index programmes_code_key on programmes (upper(code));
create index programmes_course_idx on programmes (course_id);
create index programmes_status_idx on programmes (status);
create index programmes_dates_idx on programmes (start_date, end_date);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id) on delete cascade,
  title text not null,
  kind text not null default 'class' check (kind in ('class','exam','practical')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  instructor_id uuid references users(id),
  classroom_id uuid references classrooms(id),
  location text,
  qr_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- an instructor or a room cannot be in two places at once
  constraint sessions_no_instructor_overlap exclude using gist
    (instructor_id with =, tstzrange(starts_at, ends_at) with &&) where (instructor_id is not null),
  constraint sessions_no_room_overlap exclude using gist
    (classroom_id with =, tstzrange(starts_at, ends_at) with &&) where (classroom_id is not null)
);
create index sessions_programme_idx on sessions (programme_id, starts_at);
create index sessions_time_idx on sessions (starts_at);

-- ---------------------------------------------------------------- enrolment and attendance

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id),
  trainee_id uuid not null references users(id),
  status text not null default 'pending'
    check (status in ('pending','confirmed','waitlisted','cancelled','completed','no_show')),
  sponsor_organization_id uuid references organizations(id),
  registered_by uuid references users(id),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programme_id, trainee_id)
);
create index enrollments_trainee_idx on enrollments (trainee_id);
create index enrollments_status_idx on enrollments (programme_id, status);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  trainee_id uuid not null references users(id),
  status text not null check (status in ('present','absent','late','excused')),
  method text not null default 'manual' check (method in ('manual','qr')),
  marked_by uuid references users(id),
  marked_at timestamptz not null default now(),
  note text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  unique (session_id, trainee_id)
);
create index attendance_trainee_idx on attendance (trainee_id);

-- ---------------------------------------------------------------- assessment

create table questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  module_id uuid references course_modules(id),
  topic text,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  type text not null check (type in ('mcq_single','mcq_multi','true_false','short_answer','essay','matching','scenario')),
  prompt text not null,
  options jsonb,                  -- choices, or {left:[], right:[]} for matching
  answer jsonb,                   -- correct answer(s); null for essay and scenario
  marks numeric(6,2) not null default 1 check (marks > 0),
  explanation text,
  status text not null default 'active' check (status in ('active','retired')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index questions_course_idx on questions (course_id, status);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  programme_id uuid references programmes(id),
  title text not null,
  kind text not null default 'exam' check (kind in ('exam','quiz','practical')),
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  pass_mark integer not null default 70 check (pass_mark between 0 and 100),
  max_attempts integer not null default 1 check (max_attempts > 0),
  randomize boolean not null default true,
  release_mode text not null default 'manual' check (release_mode in ('immediate','manual')),
  opens_at timestamptz,
  closes_at timestamptz,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assessments_programme_idx on assessments (programme_id);

create table assessment_questions (
  assessment_id uuid not null references assessments(id) on delete cascade,
  question_id uuid not null references questions(id),
  position integer not null default 0,
  marks numeric(6,2) not null check (marks > 0),
  primary key (assessment_id, question_id)
);

create table exam_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id),
  trainee_id uuid not null references users(id),
  attempt_no integer not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,       -- enforced on the server, never trusted from the client
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','marked')),
  question_order jsonb not null,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  results_released boolean not null default false,
  marked_by uuid references users(id),
  marked_at timestamptz,
  unique (assessment_id, trainee_id, attempt_no)
);
create index exam_attempts_trainee_idx on exam_attempts (trainee_id);

create table attempt_answers (
  attempt_id uuid not null references exam_attempts(id) on delete cascade,
  question_id uuid not null references questions(id),
  response jsonb,
  awarded_marks numeric(6,2),
  needs_manual boolean not null default false,
  feedback text,
  marked_by uuid references users(id),
  saved_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

-- ---------------------------------------------------------------- results and certificates

create table results (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references enrollments(id),
  final_score numeric(5,2),
  attendance_pct numeric(5,2),
  status text not null default 'pending'
    check (status in ('pass','fail','pending','absent','disqualified')),
  finalised boolean not null default false,
  finalised_by uuid references users(id),
  finalised_at timestamptz,
  released boolean not null default false,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table result_changes (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references results(id),
  old_status text,
  new_status text,
  old_score numeric(5,2),
  new_score numeric(5,2),
  reason text not null,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now()
);

create table certificate_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_id uuid references organizations(id),
  heading text not null default 'Certificate of Completion',
  signatory_name text,
  signatory_title text,
  footer_text text,
  accent_color text not null default '#1f3a5f' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index certificate_templates_one_default on certificate_templates (is_default) where is_default;

create table certificate_sequences (
  year integer not null,
  category_code text not null,
  last_value integer not null default 0,
  primary key (year, category_code)
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  verification_token text not null unique,   -- unguessable; the QR code carries this, not the number
  enrollment_id uuid not null references enrollments(id),
  trainee_id uuid not null references users(id),
  course_id uuid not null references courses(id),
  programme_id uuid not null references programmes(id),
  template_id uuid references certificate_templates(id),
  issued_at date not null default current_date,
  expires_at date,
  status text not null default 'valid' check (status in ('valid','revoked')),
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  revoke_reason text,
  renewal_of uuid references certificates(id),
  issued_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (status <> 'revoked' or (revoked_at is not null and revoke_reason is not null))
);
-- one live certificate per enrolment
create unique index certificates_one_live_per_enrollment on certificates (enrollment_id) where status = 'valid';
create index certificates_trainee_idx on certificates (trainee_id);
create index certificates_expiry_idx on certificates (expires_at) where status = 'valid';

-- ---------------------------------------------------------------- finance

create table invoice_sequences (
  year integer primary key,
  last_value integer not null default 0
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  organization_id uuid references organizations(id),
  trainee_id uuid references users(id),
  programme_id uuid references programmes(id),
  enrollment_id uuid references enrollments(id),
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'GHS',
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','partially_paid','paid','failed','refunded','cancelled')),
  purchase_order text,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (organization_id is not null or trainee_id is not null)
);
create index invoices_org_idx on invoices (organization_id);
create index invoices_trainee_idx on invoices (trainee_id);
create index invoices_status_idx on invoices (status);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric(8,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0)
);

create table receipt_sequences (
  year integer primary key,
  last_value integer not null default 0
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  receipt_number text not null unique,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','bank_transfer','mobile_money','card','cheque','other')),
  reference text,
  received_at timestamptz not null default now(),
  status text not null default 'paid' check (status in ('paid','failed','refunded','cancelled')),
  note text,
  recorded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on payments (invoice_id);

-- ---------------------------------------------------------------- compliance, notifications, settings

create table compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  organization_id uuid references organizations(id),   -- null means all trainees
  aviation_role text,                                 -- null means any role
  grace_days integer not null default 0 check (grace_days >= 0),
  created_at timestamptz not null default now()
);
create unique index compliance_requirements_key on compliance_requirements
  (course_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(aviation_role, ''));

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  to_email text,
  channel text not null default 'in_app' check (channel in ('in_app','email','sms')),
  kind text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','read')),
  attempts integer not null default 0,
  error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_pending_idx on notifications (status) where status = 'pending';
create unique index notifications_dedupe on notifications (dedupe_key) where dedupe_key is not null;

create table settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit log

create table audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  ip text,
  before_data jsonb,
  after_data jsonb,
  seq bigint not null default 0,          -- position in the hash chain, assigned under a lock
  prev_hash text not null default '',
  hash text not null default ''
);
create unique index audit_logs_seq_key on audit_logs (seq);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on audit_logs (actor_id);
create index audit_logs_at_idx on audit_logs (at desc);

-- Each row stores a hash chained to the previous row, so any edit or deletion
-- breaks the chain and is detectable (GET /audit/verify).
create or replace function audit_chain() returns trigger language plpgsql as $$
declare
  last_hash text;
  last_seq bigint;
begin
  perform pg_advisory_xact_lock(727001);
  select hash, seq into last_hash, last_seq from audit_logs order by seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, '');
  new.hash := encode(sha256(convert_to(
      new.prev_hash || '|' || new.seq::text || '|' || new.at::text || '|' ||
      coalesce(new.actor_id::text, '') || '|' || new.action || '|' || new.entity_type || '|' ||
      coalesce(new.entity_id, '') || '|' || coalesce(new.before_data::text, '') || '|' ||
      coalesce(new.after_data::text, ''), 'UTF8')), 'hex');
  return new;
end $$;
create trigger audit_logs_chain before insert on audit_logs for each row execute function audit_chain();

create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on audit_logs for each row execute function audit_immutable();
create trigger audit_logs_no_truncate before truncate on audit_logs for each statement execute function audit_immutable();

-- ---------------------------------------------------------------- housekeeping

do $$
declare t text;
begin
  for t in select unnest(array[
    'organizations','users','trainee_profiles','instructor_profiles','courses','programmes','sessions',
    'enrollments','questions','assessments','results','invoices'])
  loop
    execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;

  -- deny by default for the Supabase auto-generated API
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;

insert into settings (key, value) values
  ('organization', '{"name":"HAAB Aviation Consultancy Services Ltd.","address":"","email":"","phone":"","website":""}'),
  ('finance', '{"currency":"GHS","tax_rate":0,"require_payment_before_confirmation":false,"invoice_due_days":14}'),
  ('training', '{"default_pass_mark":70,"default_min_attendance_pct":80,"certificate_expiring_soon_days":60,"enforce_maker_checker":true}'),
  ('notifications', '{"email_enabled":true,"expiry_reminder_days":[90,60,30]}');

insert into certificate_templates (name, heading, is_default, signatory_title)
values ('Default', 'Certificate of Completion', true, 'Authorised Signatory');
