// Reads and writes a day's entries in Supabase. Row level security limits every query to the signed-in user.

import { getSupabase } from "@/lib/supabase/client";
import { dayRangeIso } from "@/lib/day/dates";
import type {
  ActivityRow,
  ActivityValues,
  DrinkRow,
  DrinkValues,
  FoodItemRow,
  FoodRow,
  FoodValues,
  WeightRow,
  WeightValues,
} from "@/lib/day/entries";
import type { DayData } from "@/lib/day/summary";

function fail(message: string): never {
  throw new Error(message);
}

export type LoadedDay = DayData & {
  /** Most recent weigh-in up to the end of the day, used for the expenditure estimate. */
  latestWeightKg: number | null;
};

export async function loadDay(userId: string, day: Date): Promise<LoadedDay> {
  const supabase = getSupabase();
  const { from, to } = dayRangeIso(day);

  const [foods, drinks, activities, weights, latestWeight] = await Promise.all([
    supabase
      .from("food_entries")
      .select("id, consumed_at, name, meal_type, source, notes")
      .eq("user_id", userId)
      .gte("consumed_at", from)
      .lt("consumed_at", to),
    supabase
      .from("drink_entries")
      .select("id, consumed_at, drink_type, volume_ml, calories_kcal, caffeine_mg, hydration_ml, notes")
      .eq("user_id", userId)
      .gte("consumed_at", from)
      .lt("consumed_at", to),
    supabase
      .from("activities")
      .select(
        "id, started_at, activity_type, duration_seconds, distance_m, calories_active_kcal, calories_total_kcal, " +
          "calories_source, external_provider, excluded_from_balance, notes",
      )
      .eq("user_id", userId)
      .gte("started_at", from)
      .lt("started_at", to),
    supabase
      .from("weight_logs")
      .select("id, measured_at, weight_kg, measurement_conditions, source, notes")
      .eq("user_id", userId)
      .gte("measured_at", from)
      .lt("measured_at", to),
    supabase
      .from("weight_logs")
      .select("weight_kg")
      .eq("user_id", userId)
      .lt("measured_at", to)
      .order("measured_at", { ascending: false })
      .limit(1),
  ]);

  if (foods.error) fail(foods.error.message);
  if (drinks.error) fail(drinks.error.message);
  if (activities.error) fail(activities.error.message);
  if (weights.error) fail(weights.error.message);
  if (latestWeight.error) fail(latestWeight.error.message);

  const foodRows = (foods.data ?? []) as unknown as Omit<FoodRow, "items">[];
  let items: FoodItemRow[] = [];
  if (foodRows.length > 0) {
    const result = await supabase
      .from("food_entry_items")
      .select("id, food_entry_id, food_name, quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", userId)
      .in(
        "food_entry_id",
        foodRows.map((row) => row.id),
      );
    if (result.error) fail(result.error.message);
    items = (result.data ?? []) as unknown as FoodItemRow[];
  }

  const latest = (latestWeight.data ?? []) as unknown as { weight_kg: number }[];

  return {
    foods: foodRows.map((row) => ({ ...row, items: items.filter((item) => item.food_entry_id === row.id) })),
    drinks: (drinks.data ?? []) as unknown as DrinkRow[],
    activities: (activities.data ?? []) as unknown as ActivityRow[],
    weights: (weights.data ?? []) as unknown as WeightRow[],
    latestWeightKg: latest.length > 0 ? Number(latest[0].weight_kg) : null,
  };
}

// ------------------------------------------------------------------ food

function foodItemColumns(values: FoodValues) {
  return {
    food_name: values.name,
    quantity: values.quantityG,
    quantity_unit: "g",
    calories_kcal: values.caloriesKcal,
    protein_g: values.proteinG,
    carbs_g: values.carbsG,
    fat_g: values.fatG,
    source: "manual",
  };
}

/** A manual food entry is one entry with a single item. */
export async function saveFood(userId: string, values: FoodValues, existing: FoodRow | null): Promise<void> {
  const supabase = getSupabase();
  const entryColumns = {
    consumed_at: values.consumedAt,
    name: values.name,
    meal_type: values.mealType,
    notes: values.notes,
  };

  if (!existing) {
    const created = await supabase
      .from("food_entries")
      .insert({ user_id: userId, source: "manual", ...entryColumns })
      .select("id")
      .single();
    if (created.error) fail(created.error.message);
    const entryId = (created.data as unknown as { id: string }).id;

    const item = await supabase
      .from("food_entry_items")
      .insert({ user_id: userId, food_entry_id: entryId, ...foodItemColumns(values) });
    if (item.error) {
      // Do not leave an entry without its item behind.
      await supabase.from("food_entries").delete().eq("id", entryId);
      fail(item.error.message);
    }
    return;
  }

  const updated = await supabase.from("food_entries").update(entryColumns).eq("id", existing.id);
  if (updated.error) fail(updated.error.message);

  const firstItem = existing.items[0];
  const item = firstItem
    ? await supabase
        .from("food_entry_items")
        .update({ ...foodItemColumns(values), user_corrected: true })
        .eq("id", firstItem.id)
    : await supabase
        .from("food_entry_items")
        .insert({ user_id: userId, food_entry_id: existing.id, ...foodItemColumns(values) });
  if (item.error) fail(item.error.message);
}

export async function deleteFood(id: string): Promise<void> {
  const { error } = await getSupabase().from("food_entries").delete().eq("id", id);
  if (error) fail(error.message);
}

// ------------------------------------------------------------------ drink

export async function saveDrink(userId: string, values: DrinkValues, existingId: string | null): Promise<void> {
  const supabase = getSupabase();
  const columns = {
    consumed_at: values.consumedAt,
    drink_type: values.drinkType,
    volume_ml: values.volumeMl,
    calories_kcal: values.caloriesKcal,
    caffeine_mg: values.caffeineMg,
    hydration_ml: values.hydrationMl,
    notes: values.notes,
  };
  const { error } = existingId
    ? await supabase.from("drink_entries").update(columns).eq("id", existingId)
    : await supabase.from("drink_entries").insert({ user_id: userId, ...columns });
  if (error) fail(error.message);
}

export async function deleteDrink(id: string): Promise<void> {
  const { error } = await getSupabase().from("drink_entries").delete().eq("id", id);
  if (error) fail(error.message);
}

// ------------------------------------------------------------------ activity

export async function saveActivity(userId: string, values: ActivityValues, existingId: string | null): Promise<void> {
  const supabase = getSupabase();
  const columns = {
    activity_type: values.activityType,
    started_at: values.startedAt,
    duration_seconds: values.durationSeconds,
    distance_m: values.distanceM,
    calories_active_kcal: values.caloriesActiveKcal,
    notes: values.notes,
  };
  const { error } = existingId
    ? await supabase.from("activities").update(columns).eq("id", existingId)
    : await supabase.from("activities").insert({ user_id: userId, calories_source: "manual", ...columns });
  if (error) fail(error.message);
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await getSupabase().from("activities").delete().eq("id", id);
  if (error) fail(error.message);
}

// ------------------------------------------------------------------ weight

export async function saveWeight(userId: string, values: WeightValues, existingId: string | null): Promise<void> {
  const supabase = getSupabase();
  const columns = {
    measured_at: values.measuredAt,
    weight_kg: values.weightKg,
    measurement_conditions: values.conditions,
    notes: values.notes,
  };
  const { error } = existingId
    ? await supabase.from("weight_logs").update(columns).eq("id", existingId)
    : await supabase.from("weight_logs").insert({ user_id: userId, source: "manual", ...columns });
  if (error) fail(error.message);
}

export async function deleteWeight(id: string): Promise<void> {
  const { error } = await getSupabase().from("weight_logs").delete().eq("id", id);
  if (error) fail(error.message);
}
