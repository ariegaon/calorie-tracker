-- Which app originally recorded a synced workout (for example Samsung Health or Strava).
-- Used to decide which copy counts when the same workout arrives from two sources.
alter table public.activities add column source_app text;

-- A connected outside service. Tokens are stored encrypted with a key that only the server has,
-- so reading this row from the browser does not reveal them.
create table public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('strava')),
  encrypted_tokens text not null,
  external_user_id text,
  scopes text,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create trigger set_updated_at before update on public.user_integrations
  for each row execute function public.set_updated_at();

alter table public.user_integrations enable row level security;
revoke all on public.user_integrations from anon;
revoke all on public.user_integrations from authenticated;
grant select, insert, update, delete on public.user_integrations to authenticated;

create policy "own rows: select" on public.user_integrations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.user_integrations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.user_integrations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.user_integrations for delete to authenticated
  using ((select auth.uid()) = user_id);
