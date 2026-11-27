// Reads, saves and applies favorites in Supabase.

import { getSupabase } from "@/lib/supabase/client";
import { saveDrink, saveMeal } from "@/lib/day/data";
import type { DrinkRow, FoodItemRow, FoodRow } from "@/lib/day/entries";
import { mealTitle, RECENT_DAYS, USE_WINDOW_DAYS, type HistoryEntry, type RecentEntry } from "@/lib/favorites-ranking";
import {
  drinkFromFavorite,
  mealFromFavorite,
  parseFavorite,
  type Favorite,
  type FavoriteDrinkPayload,
  type FavoriteMealPayload,
  type FavoriteRow,
} from "@/lib/favorites";

export const MAX_FAVORITES = 40;

export async function loadFavorites(userId: string): Promise<Favorite[]> {
  const { data, error } = await getSupabase()
    .from("favorites")
    .select("id, kind, name, payload, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_FAVORITES);
  if (error) throw new Error(error.message);
  const favorites: Favorite[] = [];
  for (const row of (data ?? []) as unknown as (FavoriteRow & { created_at: string | null })[]) {
    const favorite = parseFavorite(row);
    if (favorite) favorites.push({ ...favorite, createdAt: row.created_at });
  }
  return favorites;
}

export async function addFavorite(
  userId: string,
  kind: "meal" | "drink",
  name: string,
  payload: FavoriteMealPayload | FavoriteDrinkPayload,
): Promise<void> {
  const { error } = await getSupabase()
    .from("favorites")
    .insert({ user_id: userId, kind, name: name.trim().slice(0, 80), payload });
  if (error) throw new Error(error.message);
}

export async function deleteFavorite(id: string): Promise<void> {
  const { error } = await getSupabase().from("favorites").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Adds a favorite to the diary at the given time. */
export async function logFavorite(userId: string, favorite: Favorite, at: string): Promise<void> {
  if (favorite.kind === "drink") {
    await saveDrink(userId, drinkFromFavorite(favorite, at), null);
    return;
  }
  const values = mealFromFavorite(favorite, at);
  await saveMeal(userId, values, null, {
    source: "manual",
    aiRawResult: null,
    itemMeta: values.items.map(() => ({ confidence: null, fromAi: false, userCorrected: false })),
  });
}

export type FavoriteHistory = {
  /** Every meal and drink of the last weeks, for ranking and grouping the favorites. */
  entries: HistoryEntry[];
  /** The last week's meals with their items, and drinks, for "eaten recently". */
  recentFoods: FoodRow[];
  recentDrinks: DrinkRow[];
};

/** The diary history the favorites are ranked by. */
export async function loadFavoriteHistory(userId: string, now: Date): Promise<FavoriteHistory> {
  const supabase = getSupabase();
  const since = new Date(now.getTime() - USE_WINDOW_DAYS * 86_400_000).toISOString();
  const recentSince = now.getTime() - RECENT_DAYS * 86_400_000;
  const [foods, drinks] = await Promise.all([
    supabase
      .from("food_entries")
      .select("id, consumed_at, name, meal_type, source, notes")
      .eq("user_id", userId)
      .gte("consumed_at", since)
      .order("consumed_at", { ascending: false })
      .limit(1000),
    supabase
      .from("drink_entries")
      .select("id, consumed_at, drink_type, volume_ml, calories_kcal, caffeine_mg, hydration_ml, protein_g, carbs_g, fat_g, notes")
      .eq("user_id", userId)
      .gte("consumed_at", since)
      .order("consumed_at", { ascending: false })
      .limit(1000),
  ]);
  if (foods.error) throw new Error(foods.error.message);
  if (drinks.error) throw new Error(drinks.error.message);
  const foodRows = (foods.data ?? []) as unknown as Omit<FoodRow, "items">[];
  const drinkRows = (drinks.data ?? []) as unknown as DrinkRow[];

  // Items only for the last week: older meals are matched by their name.
  const recentIds = foodRows.filter((row) => new Date(row.consumed_at).getTime() >= recentSince).map((row) => row.id);
  let items: FoodItemRow[] = [];
  if (recentIds.length > 0) {
    const result = await supabase
      .from("food_entry_items")
      .select("id, food_entry_id, food_name, quantity, quantity_unit, calories_kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", userId)
      .in("food_entry_id", recentIds);
    if (result.error) throw new Error(result.error.message);
    items = (result.data ?? []) as unknown as FoodItemRow[];
  }
  const recentFoods: FoodRow[] = foodRows
    .filter((row) => recentIds.includes(row.id))
    .map((row) => ({ ...row, items: items.filter((item) => item.food_entry_id === row.id) }));

  const entries: HistoryEntry[] = [];
  for (const row of foodRows) {
    const withItems = recentFoods.find((food) => food.id === row.id);
    const name = withItems ? mealTitle(withItems) : (row.name ?? "").trim();
    if (name !== "") entries.push({ kind: "meal", name, at: new Date(row.consumed_at) });
  }
  for (const row of drinkRows) {
    entries.push({ kind: "drink", name: row.drink_type, volumeMl: Number(row.volume_ml), at: new Date(row.consumed_at) });
  }
  return {
    entries,
    recentFoods,
    recentDrinks: drinkRows.filter((row) => new Date(row.consumed_at).getTime() >= recentSince),
  };
}

/** Logs "the same again" from a recent meal or drink. */
export async function logRecent(userId: string, entry: RecentEntry, at: string): Promise<void> {
  if (entry.kind === "drink") {
    const d = entry.drink;
    await saveDrink(
      userId,
      {
        drinkType: d.drink_type,
        consumedAt: at,
        volumeMl: d.volume_ml,
        caloriesKcal: d.calories_kcal,
        caffeineMg: d.caffeine_mg,
        hydrationMl: d.hydration_ml,
        proteinG: d.protein_g,
        carbsG: d.carbs_g,
        fatG: d.fat_g,
        notes: null,
      },
      null,
    );
    return;
  }
  await saveMeal(
    userId,
    { name: entry.name, mealType: entry.mealType, consumedAt: at, notes: null, items: entry.items.map((item) => ({ ...item })) },
    null,
    {
      source: "manual",
      aiRawResult: null,
      itemMeta: entry.items.map(() => ({ confidence: null, fromAi: false, userCorrected: false })),
    },
  );
}

/** Saves a recent meal or drink as a favorite. */
export async function favoriteFromRecent(userId: string, entry: RecentEntry): Promise<void> {
  if (entry.kind === "drink") {
    const d = entry.drink;
    await addFavorite(userId, "drink", d.drink_type, {
      drinkType: d.drink_type,
      volumeMl: d.volume_ml,
      caloriesKcal: d.calories_kcal,
      caffeineMg: d.caffeine_mg,
      hydrationMl: d.hydration_ml,
      proteinG: d.protein_g,
      carbsG: d.carbs_g,
      fatG: d.fat_g,
    });
    return;
  }
  await addFavorite(userId, "meal", entry.name, { mealType: entry.mealType, items: entry.items.map((item) => ({ ...item })) });
}
