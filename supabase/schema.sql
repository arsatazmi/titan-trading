create table public.titan_demo_state (
  id integer primary key check (id = 1),
  payload jsonb not null,
  revision bigint not null default 0
);
alter table public.titan_demo_state enable row level security;
revoke all on public.titan_demo_state from anon, authenticated;
grant select, insert, update on public.titan_demo_state to service_role;
