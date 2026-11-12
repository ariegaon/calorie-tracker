-- Stage 1: core schema for data the user enters (profile, food, drinks, activities, weight).
-- Derived tables (daily summaries, predictions, calibration, integrations) are added in later stages.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  sex_for_bmr text check (sex_for_bmr in ('male', 'female')),
  birth_date date check (birth_date > date '1900-01-01'),
  height_cm numeric(5, 1) check (height_cm between 100 and 250),
  start_weight_kg numeric(5, 2) check (start_weight_kg between 30 and 300),
  target_weight_kg numeric(5, 2) check (target_weight_kg between 30 and 300),
  activity_factor numeric(3, 2) not null default 1.2 check (activity_factor between 1.1 and 2.0),
  weekly_weight_change_goal_kg numeric(3, 2) check (weekly_weight_change_goal_kg between -1.5 and 1.5),
  calorie_goal_kcal integer check (calorie_goal_kcal between 1000 and 6000),
  daily_protein_goal_g integer check (daily_protein_goal_g between 0 and 400),
  daily_water_goal_ml integer not null default 2500 check (daily_water_goal_ml between 0 and 10000),
  common_activity_types text[] not null default '{}',
  timezone text not null default 'Asia/Jerusalem',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- food
create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consumed_at timestamptz not null default now(),
  name text,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  source text not null default 'manual' check (source in ('manual', 'ai_photo', 'favorite', 'barcode')),
  image_path text,
  ai_analysis_status text not null default 'none'
    check (ai_analysis_status in ('none', 'pending', 'completed', 'failed', 'confirmed')),
  -- Original AI output, kept separate from the user's corrections.
  ai_raw_result jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.food_entry_items (
  id uuid primary key default gen_random_uuid(),
  food_entry_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_name text not null check (length(trim(food_name)) > 0),
  quantity numeric(8, 2) check (quantity > 0),
  quantity_unit text not null default 'g' check (quantity_unit in ('g', 'ml', 'unit')),
  calories_kcal numeric(8, 2) not null default 0 check (calories_kcal >= 0),
  protein_g numeric(7, 2) not null default 0 check (protein_g >= 0),
  carbs_g numeric(7, 2) not null default 0 check (carbs_g >= 0),
  fat_g numeric(7, 2) not null default 0 check (fat_g >= 0),
  fiber_g numeric(7, 2) check (fiber_g >= 0),
  preparation_method text,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  source text not null default 'manual' check (source in ('manual', 'ai_estimate', 'database')),
  user_corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An item can only belong to an entry owned by the same user.
  foreign key (food_entry_id, user_id) references public.food_entries (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------- drinks
create table public.drink_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consumed_at timestamptz not null default now(),
  drink_type text not null check (length(trim(drink_type)) > 0),
  volume_ml integer not null check (volume_ml > 0 and volume_ml <= 5000),
  calories_kcal numeric(7, 2) not null default 0 check (calories_kcal >= 0),
  caffeine_mg numeric(6, 1) check (caffeine_mg >= 0),
  hydration_ml integer not null default 0 check (hydration_ml >= 0),
  additions jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- activities
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  external_provider text check (external_provider in ('health_connect', 'strava', 'screenshot')),
  external_activity_id text,
  activity_type text not null check (length(trim(activity_type)) > 0),
  started_at timestamptz not null,
  duration_seconds integer check (duration_seconds > 0),
  distance_m numeric(10, 1) check (distance_m >= 0),
  calories_active_kcal numeric(7, 1) check (calories_active_kcal >= 0),
  calories_total_kcal numeric(7, 1) check (calories_total_kcal >= 0),
  calories_source text not null default 'manual' check (calories_source in ('external', 'manual', 'estimated')),
  heart_rate_avg integer check (heart_rate_avg between 20 and 250),
  heart_rate_max integer check (heart_rate_max between 20 and 250),
  elevation_gain_m numeric(7, 1),
  -- Set when the same workout arrived twice (e.g. synced and typed in) so it is counted once.
  excluded_from_balance boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((external_provider is null) = (external_activity_id is null)),
  unique (user_id, external_provider, external_activity_id)
);

-- ---------------------------------------------------------------- weight and body
create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_at timestamptz not null default now(),
  weight_kg numeric(5, 2) not null check (weight_kg between 30 and 300),
  measurement_conditions text,
  source text not null default 'manual' check (source in ('manual', 'smart_scale', 'health_connect', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_at timestamptz not null default now(),
  waist_cm numeric(5, 1) check (waist_cm between 30 and 250),
  chest_cm numeric(5, 1) check (chest_cm between 30 and 250),
  hips_cm numeric(5, 1) check (hips_cm between 30 and 250),
  thigh_cm numeric(5, 1) check (thigh_cm between 10 and 150),
  arm_cm numeric(5, 1) check (arm_cm between 10 and 100),
  body_fat_percent numeric(4, 1) check (body_fat_percent between 2 and 70),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index food_entries_user_time_idx on public.food_entries (user_id, consumed_at desc);
create index food_entry_items_entry_idx on public.food_entry_items (food_entry_id, user_id);
create index food_entry_items_user_idx on public.food_entry_items (user_id);
create index drink_entries_user_time_idx on public.drink_entries (user_id, consumed_at desc);
create index activities_user_time_idx on public.activities (user_id, started_at desc);
create index weight_logs_user_time_idx on public.weight_logs (user_id, measured_at desc);
create index body_measurements_user_time_idx on public.body_measurements (user_id, measured_at desc);

-- ---------------------------------------------------------------- triggers, grants, RLS
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'food_entries', 'food_entry_items', 'drink_entries',
    'activities', 'weight_logs', 'body_measurements'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated
         using ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated
         with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "own rows: delete" on public.%I for delete to authenticated
         using ((select auth.uid()) = user_id)', t);
  end loop;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
