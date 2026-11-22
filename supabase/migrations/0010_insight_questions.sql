-- Consent to send summaries of the user's data to the AI provider (questions and the wording of
-- weekly insights). Null means no consent: nothing is sent, and weekly insights use the app's own wording.
alter table public.profiles add column if not exists ai_insights_consent_at timestamptz;

-- Questions the user asked about their own data, with the answers.
create table if not exists public.insight_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) between 1 and 4000),
  insight_id uuid references public.insights (id) on delete set null
);

create index if not exists insight_questions_user_time_idx on public.insight_questions (user_id, created_at desc);

alter table public.insight_questions enable row level security;
revoke all on public.insight_questions from anon;
revoke all on public.insight_questions from authenticated;
grant select, insert, delete on public.insight_questions to authenticated;

create policy "own rows: select" on public.insight_questions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.insight_questions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.insight_questions for delete to authenticated
  using ((select auth.uid()) = user_id);
