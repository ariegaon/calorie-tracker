-- Drinks such as milk coffee or a protein shake carry protein, carbs and fat too.
alter table public.drink_entries
  add column protein_g numeric(7, 2) not null default 0 check (protein_g >= 0),
  add column carbs_g numeric(7, 2) not null default 0 check (carbs_g >= 0),
  add column fat_g numeric(7, 2) not null default 0 check (fat_g >= 0);

-- Saved meals and drinks that can be logged again with one tap.
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('meal', 'drink')),
  name text not null check (length(trim(name)) > 0 and length(name) <= 80),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index favorites_user_idx on public.favorites (user_id, created_at);

create trigger set_updated_at before update on public.favorites
  for each row execute function public.set_updated_at();

alter table public.favorites enable row level security;
revoke all on public.favorites from anon;
grant select, insert, update, delete on public.favorites to authenticated;

create policy "own rows: select" on public.favorites for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.favorites for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.favorites for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.favorites for delete to authenticated
  using ((select auth.uid()) = user_id);
