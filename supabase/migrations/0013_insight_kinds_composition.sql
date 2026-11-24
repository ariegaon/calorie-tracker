-- Two more weekly insight kinds: a flat scale with a shrinking waist, and a jump after heavier training.
alter table public.insights drop constraint if exists insights_kind_check;
alter table public.insights add constraint insights_kind_check check (kind in (
  'delayed_compensation', 'weigh_in_conditions', 'small_swap', 'goal_reality', 'outlier_days', 'logging_blind_spots',
  'day_tags', 'recomposition', 'training_water'
));
