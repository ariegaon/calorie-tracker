-- Meals analysed from a text description get their own source value.
alter table public.food_entries drop constraint food_entries_source_check;
alter table public.food_entries add constraint food_entries_source_check
  check (source in ('manual', 'ai_photo', 'ai_text', 'favorite', 'barcode'));

-- One row per AI analysis request, used to cap daily usage per user.
-- Rows can be added and read by their owner, never changed or removed.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('meal_text', 'meal_photo')),
  created_at timestamptz not null default now()
);

create index ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon;
revoke all on public.ai_usage from authenticated;
grant select, insert on public.ai_usage to authenticated;

create policy "own rows: select" on public.ai_usage for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.ai_usage for insert to authenticated
  with check ((select auth.uid()) = user_id);
