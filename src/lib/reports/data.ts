// Loads every entry of a range of days, grouped by local day.

import { getSupabase } from "@/lib/supabase/client";
import type { ActivityRow, DrinkRow, FoodItemRow, FoodRow, WeightRow } from "@/lib/day/entries";
import type { DayData } from "@/lib/day/summary";
import { dateOfDay, dayIndex } from "@/lib/weight/trend";

function fail(message: string): never {
  throw new Error(message);
}

export type RangeDay = { day: number; data: DayData | null };

/** One element per day from firstDay to lastDay inclusive; `data` is null for days without any entry. */
export async function loadRangeDays(userId: string, firstDay: number, lastDay: number): Promise<RangeDay[]> {
  const supabase = getSupabase();
  const from = dateOfDay(firstDay).toISOString();
  const to = dateOfDay(lastDay + 1).toISOString();

  const [foods, drinks, activities, weights] = await Promise.all([
    supabase
      .from("food_entries")
      .select("id, consumed_at, name, meal_type, source, notes")
      .eq("user_id", userId)
      .gte("consumed_at", from)
      .lt("consumed_at", to)
      .limit(3000),
    supabase
      .from("drink_entries")
      .select("id, consumed_at, drink_type, volume_ml, calories_kcal, caffeine_mg, hydration_ml, protein_g, carbs_g, fat_g, notes")
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
    supabase
      .from("weight_logs")
      .select("id, measured_at, weight_kg, measurement_conditions, source, notes")
      .eq("user_id", userId)
      .gte("measured_at", from)
      .lt("measured_at", to)
      .limit(3000),
  ]);
  if (foods.error) fail(foods.error.message);
  if (drinks.error) fail(drinks.error.message);
  if (activities.error) fail(activities.error.message);
  if (weights.error) fail(weights.error.message);

  // Items are fetched through their entries' ids, in chunks to keep request URLs short.
  const foodRows = (foods.data ?? []) as unknown as Omit<FoodRow, "items">[];
  const itemsByEntry = new Map<string, FoodItemRow[]>();
  for (let start = 0; start < foodRows.length; start += 100) {
    const ids = foodRows.slice(start, start + 100).map((row) => row.id);
    const result = await supabase
      .from("food_entry_items")
      .select("id, food_entry_id, food_name, quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g, confidence, source, user_corrected")
      .eq("user_id", userId)
      .in("food_entry_id", ids);
    if (result.error) fail(result.error.message);
    for (const item of (result.data ?? []) as unknown as FoodItemRow[]) {
      const list = itemsByEntry.get(item.food_entry_id) ?? [];
      list.push(item);
      itemsByEntry.set(item.food_entry_id, list);
    }
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
  for (const row of (weights.data ?? []) as unknown as WeightRow[]) bucket(row.measured_at).weights.push(row);

  const result: RangeDay[] = [];
  for (let day = firstDay; day <= lastDay; day += 1) result.push({ day, data: days.get(day) ?? null });
  return result;
}
