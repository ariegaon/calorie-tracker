-- Weekly insights. The numbers in `facts` are computed by the app's analyses; the AI editor (or a
-- template, when the AI is not available) only chooses one finding and words it.
create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in (
    'delayed_compensation', 'weigh_in_conditions', 'small_swap', 'goal_reality', 'outlier_days', 'logging_blind_spots'
  )),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 1200),
  action text check (char_length(action) <= 400),
  facts jsonb not null default '{}'::jsonb,
  source text not null check (source in ('ai', 'template')),
  seen_at timestamptz,
  feedback text check (feedback in ('useful', 'not_relevant')),
  feedback_at timestamptz
);

create index if not exists insights_user_time_idx on public.insights (user_id, created_at desc);

alter table public.insights enable row level security;
revoke all on public.insights from anon;
revoke all on public.insights from authenticated;
grant select, insert on public.insights to authenticated;
-- Only the reading state and the feedback can change after an insight is written.
grant update (seen_at, feedback, feedback_at) on public.insights to authenticated;

create policy "own rows: select" on public.insights for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.insights for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.insights for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- AI usage now also covers composing insights and answering questions.
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check
  check (kind in ('meal_text', 'meal_photo', 'insight', 'question'));
