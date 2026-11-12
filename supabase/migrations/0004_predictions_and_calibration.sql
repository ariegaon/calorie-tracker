-- Daily snapshot of the forecast, kept so it can later be compared with what actually happened.
create table public.weight_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  prediction_date date not null,
  target_date date not null check (target_date >= prediction_date),
  theoretical_weight_kg numeric(5, 2),
  trend_weight_kg numeric(5, 2),
  combined_weight_kg numeric(5, 2),
  lower_bound_kg numeric(5, 2),
  upper_bound_kg numeric(5, 2),
  model_version text not null,
  created_at timestamptz not null default now(),
  unique (user_id, prediction_date, target_date)
);

create index weight_predictions_user_target_idx on public.weight_predictions (user_id, target_date, prediction_date);

alter table public.weight_predictions enable row level security;
revoke all on public.weight_predictions from anon;
revoke all on public.weight_predictions from authenticated;
grant select, insert, update on public.weight_predictions to authenticated;

create policy "own rows: select" on public.weight_predictions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.weight_predictions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.weight_predictions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Calibration history. Each row is a decision the user confirmed; rows are never changed or removed,
-- and the most recent one is the adjustment in force.
create table public.metabolic_calibration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  effective_at timestamptz not null default now(),
  adjustment_kcal integer not null check (adjustment_kcal between -500 and 500),
  previous_adjustment_kcal integer not null default 0,
  gap_kcal_per_day numeric(7, 1),
  weigh_days integer,
  documented_days integer,
  explanation text not null,
  created_at timestamptz not null default now()
);

create index metabolic_calibration_user_time_idx on public.metabolic_calibration (user_id, effective_at desc);

alter table public.metabolic_calibration enable row level security;
revoke all on public.metabolic_calibration from anon;
revoke all on public.metabolic_calibration from authenticated;
grant select, insert on public.metabolic_calibration to authenticated;

create policy "own rows: select" on public.metabolic_calibration for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.metabolic_calibration for insert to authenticated
  with check ((select auth.uid()) = user_id);
