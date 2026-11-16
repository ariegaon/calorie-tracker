-- Workouts read from Apple Health on an iPhone are a provider of their own.
alter table public.activities drop constraint activities_external_provider_check;
alter table public.activities add constraint activities_external_provider_check
  check (external_provider in ('health_connect', 'apple_health', 'strava', 'screenshot'));
