-- Goal by date: when set, the daily calorie target is derived from the target weight and this date
-- instead of the fixed weekly pace.
alter table public.profiles
  add column if not exists target_date date,
  -- A fixed daily allowance for snacks that are not logged (bagel, a cookie, a bite here and there).
  -- Null or 0 means off. Counted as eaten, and always shown as an estimate.
  add column if not exists snack_allowance_kcal integer check (snack_allowance_kcal between 0 and 800),
  -- How the allowance was set: 'manual', 'suggested' or 'ai', and the description the AI estimate came from.
  add column if not exists snack_allowance_source text check (snack_allowance_source in ('manual', 'suggested', 'ai')),
  add column if not exists snack_allowance_note text check (char_length(snack_allowance_note) <= 300);

-- Days on which the user said everything was logged, so the snack allowance is not added.
create table if not exists public.snack_allowance_skips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.snack_allowance_skips enable row level security;

create policy "own rows: select" on public.snack_allowance_skips
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.snack_allowance_skips
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.snack_allowance_skips
  for delete to authenticated using ((select auth.uid()) = user_id);
