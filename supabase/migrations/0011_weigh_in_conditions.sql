-- The user's own list of weigh-in conditions. Seeded with the defaults on first use; names can be
-- edited (past weigh-ins follow the new name) and hidden (past weigh-ins keep theirs).
create table if not exists public.weigh_in_conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  position integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists weigh_in_conditions_user_idx on public.weigh_in_conditions (user_id, position);

alter table public.weigh_in_conditions enable row level security;

create policy "own rows: select" on public.weigh_in_conditions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.weigh_in_conditions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.weigh_in_conditions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.weigh_in_conditions for delete to authenticated
  using ((select auth.uid()) = user_id);
