-- Fat and carbohydrate goals the user sets themselves. Null means "follow the recommendation",
-- which the app computes from the calorie target (daily_protein_goal_g now has the same meaning).
-- profiles already has RLS limited to the user's own row.
alter table public.profiles
  add column if not exists daily_fat_goal_g integer check (daily_fat_goal_g is null or (daily_fat_goal_g > 0 and daily_fat_goal_g <= 400)),
  add column if not exists daily_carbs_goal_g integer check (daily_carbs_goal_g is null or (daily_carbs_goal_g > 0 and daily_carbs_goal_g <= 800));
