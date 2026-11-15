-- Titan Vault production schema.
-- Applied to the connected Supabase project as migration `titan_vault_real_backend`.
-- All access goes through the server-side service role; anon/authenticated have no grants.

create table if not exists public.titan_vault_users (
  uid uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  data jsonb not null default '{}'::jsonb,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists titan_vault_users_email_idx on public.titan_vault_users (email);

create table if not exists public.titan_vault_events (
  id bigserial primary key,
  actor_uid uuid,
  actor_email text not null default '',
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists titan_vault_events_created_idx on public.titan_vault_events (created_at desc);

alter table public.titan_vault_users enable row level security;
alter table public.titan_vault_events enable row level security;

revoke all on public.titan_vault_users from anon, authenticated;
revoke all on public.titan_vault_events from anon, authenticated;
revoke all on public.titan_vault_events_id_seq from anon, authenticated;

grant select, insert, update on public.titan_vault_users to service_role;
grant select, insert on public.titan_vault_events to service_role;
grant usage, select on public.titan_vault_events_id_seq to service_role;
