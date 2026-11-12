// Loads what the weight screen needs: every weigh-in, and a calorie balance for each recent day.

import { getSupabase } from "@/lib/supabase/client";
import type { ActivityRow, DrinkRow, FoodItemRow, FoodRow, WeightRow } from "@/lib/day/entries";
import { summarizeDay, type DayData } from "@/lib/day/summary";
import { dateOfDay, dayIndex, type DayBalance } from "@/lib/weight/trend";

/** Days of entries loaded for balances: covers the 28-day window and a full month to date. */
export const BALANCE_HISTORY_DAYS = 35;

function fail(message: string): never {
  throw new Error(message);
}

export async function loadWeights(userId: string): Promise<WeightRow[]> {
  const { data, error } = await getSupabase()
    .from("weight_logs")
    .select("id, measured_at, weight_kg, measurement_conditions, source, notes")
    .eq("user_id", userId)
    .order("measured_at", { ascending: true })
    .limit(2000);
  if (error) fail(error.message);
  return (data ?? []) as unknown as WeightRow[];
}

/**
 * A calorie balance for each of the last days, ending today.
 * One expenditure estimate (from the current weight) is used for all days: a stated simplification.
 */
export async function loadDayBalances(
  userId: string,
  today: Date,
  energy: { bmr: number; baselineKcal: number },
): Promise<DayBalance[]> {
  const supabase = getSupabase();
  const todayIndex = dayIndex(today);
  const firstDay = todayIndex - BALANCE_HISTORY_DAYS + 1;
  const from = dateOfDay(firstDay).toISOString();
  const to = dateOfDay(todayIndex + 1).toISOString();

  const [foods, drinks, activities] = await Promise.all([
    supabase
      .from("food_entries")
      .select("id, consumed_at, name, meal_type, source, notes")
      .eq("user_id", userId)
      .gte("consumed_at", from)
      .lt("consumed_at", to)
      .limit(3000),
    supabase
      .from("drink_entries")
      .select("id, consumed_at, drink_type, volume_ml, calories_kcal, caffeine_mg, hydration_ml, notes")
      .eq("user_id", userId)
      .gte("consumed_at", from)
      .lt("consumed_at", to)
      .limit(3000),
    supabase
      .from("activities")
      .select(
        "id, started_at, activity_type, duration_seconds, distance_m, calories_active_kcal, calories_total_kcal, " +
          "calories_source, external_provider, excluded_from_balance, notes",
      )
      .eq("user_id", userId)
      .gte("started_at", from)
      .lt("started_at", to)
      .limit(3000),
  ]);
  if (foods.error) fail(foods.error.message);
  if (drinks.error) fail(drinks.error.message);
  if (activities.error) fail(activities.error.message);

  // Items are fetched by time range through their entries' ids, in chunks to keep URLs short.
  const foodRows = (foods.data ?? []) as unknown as Omit<FoodRow, "items">[];
  const items: FoodItemRow[] = [];
  for (let start = 0; start < foodRows.length; start += 100) {
    const ids = foodRows.slice(start, start + 100).map((row) => row.id);
    const result = await supabase
      .from("food_entry_items")
      .select("id, food_entry_id, food_name, quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", userId)
      .in("food_entry_id", ids);
    if (result.error) fail(result.error.message);
    items.push(...((result.data ?? []) as unknown as FoodItemRow[]));
  }
  const itemsByEntry = new Map<string, FoodItemRow[]>();
  for (const item of items) {
    const list = itemsByEntry.get(item.food_entry_id) ?? [];
    list.push(item);
    itemsByEntry.set(item.food_entry_id, list);
  }

  const days = new Map<number, DayData>();
  const bucket = (iso: string): DayData => {
    const index = dayIndex(new Date(iso));
    let day = days.get(index);
    if (!day) {
      day = { foods: [], drinks: [], activities: [], weights: [] };
      days.set(index, day);
    }
    return day;
  };
  for (const row of foodRows) bucket(row.consumed_at).foods.push({ ...row, items: itemsByEntry.get(row.id) ?? [] });
  for (const row of (drinks.data ?? []) as unknown as DrinkRow[]) bucket(row.consumed_at).drinks.push(row);
  for (const row of (activities.data ?? []) as unknown as ActivityRow[]) bucket(row.started_at).activities.push(row);

  const balances: DayBalance[] = [];
  for (let day = firstDay; day <= todayIndex; day += 1) {
    const data = days.get(day);
    if (!data) {
      balances.push({ day, balanceKcal: 0, documented: false });
      continue;
    }
    const summary = summarizeDay(data, energy);
    balances.push({ day, balanceKcal: summary.balance?.balanceKcal ?? 0, documented: summary.hasFood });
  }
  return balances;
}
