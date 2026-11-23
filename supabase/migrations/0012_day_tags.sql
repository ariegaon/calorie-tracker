-- Personal day tags: marks without calories ("event", "ate out", "bad sleep"...) that the insights
-- compare against. Each user has their own list, seeded with defaults on first use.
create table if not exists public.day_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  position integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists day_tags_user_idx on public.day_tags (user_id, position);

-- A tag marked on a day. Several tags may be marked on the same day; each at most once.
create table if not exists public.day_tag_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tag_id uuid not null references public.day_tags (id) on delete cascade,
  day date not null,
  note text check (char_length(note) <= 100),
  created_at timestamptz not null default now(),
  unique (user_id, tag_id, day)
);

create index if not exists day_tag_marks_user_day_idx on public.day_tag_marks (user_id, day);

alter table public.day_tags enable row level security;
alter table public.day_tag_marks enable row level security;

create policy "own rows: select" on public.day_tags for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.day_tags for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.day_tags for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.day_tags for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own rows: select" on public.day_tag_marks for select to authenticated using ((select auth.uid()) = user_id);
-- A mark may only point at one of the user's own tags.
create policy "own rows: insert" on public.day_tag_marks for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.day_tags t where t.id = tag_id and t.user_id = (select auth.uid()))
  );
create policy "own rows: update" on public.day_tag_marks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.day_tag_marks for delete to authenticated using ((select auth.uid()) = user_id);

-- A new kind of weekly insight: what a tagged day does to intake.
alter table public.insights drop constraint if exists insights_kind_check;
alter table public.insights add constraint insights_kind_check check (kind in (
  'delayed_compensation', 'weigh_in_conditions', 'small_swap', 'goal_reality', 'outlier_days', 'logging_blind_spots',
  'day_tags'
));
