-- Trainees can ask for an account. A HAAB administrator approves or rejects each request;
-- approval creates the trainee and sends the invitation, which also proves they own the email address.
create table registration_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  phone text,
  organisation_text text,                 -- what the person typed; the approver picks the real organisation
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  reject_reason text,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);
create unique index registration_pending_email on registration_requests (lower(email)) where status = 'pending';
create index registration_status_idx on registration_requests (status, created_at desc);
alter table registration_requests enable row level security;
