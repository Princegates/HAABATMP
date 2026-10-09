-- Integration credentials managed by super administrators from the application.
-- Secret values are AES-256-GCM ciphertext (key held on the host, never in the database).
create table integrations (
  key text primary key,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,        -- non-secret settings, for example sender address
  secrets jsonb not null default '{}'::jsonb,       -- field name -> ciphertext
  secrets_updated_at timestamptz,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create trigger integrations_updated before update on integrations for each row execute function set_updated_at();
alter table integrations enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on integrations from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on integrations from authenticated'; end if;
end $$;
