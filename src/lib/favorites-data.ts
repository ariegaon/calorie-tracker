// Reads, saves and applies favorites in Supabase.

import { getSupabase } from "@/lib/supabase/client";
import { saveDrink, saveMeal } from "@/lib/day/data";
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
    .select("id, kind, name, payload")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_FAVORITES);
  if (error) throw new Error(error.message);
  const favorites: Favorite[] = [];
  for (const row of (data ?? []) as unknown as FavoriteRow[]) {
    const favorite = parseFavorite(row);
    if (favorite) favorites.push(favorite);
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
