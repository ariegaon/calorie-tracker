// Favorites: saved meals and drinks that can be logged again with one tap. Pure code.
// The stored payload is checked on the way out of the database before it is used.

import type { DrinkValues, MealItemValues, MealType, MealValues } from "./day/entries.ts";

export type FavoriteMealPayload = {
  mealType: MealType | null;
  items: MealItemValues[];
};

export type FavoriteDrinkPayload = {
  drinkType: string;
  volumeMl: number;
  caloriesKcal: number;
  caffeineMg: number | null;
  hydrationMl: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type Favorite =
  | { id: string; name: string; kind: "meal"; payload: FavoriteMealPayload }
  | { id: string; name: string; kind: "drink"; payload: FavoriteDrinkPayload };

export type FavoriteRow = { id: string; kind: string; name: string; payload: unknown };

const MEAL_TYPES: readonly string[] = ["breakfast", "lunch", "dinner", "snack"];

function amount(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turns a database row into a favorite. Null when the stored payload is not usable. */
export function parseFavorite(row: FavoriteRow): Favorite | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (name === "" || !isRecord(row.payload)) return null;
  const payload = row.payload;

  if (row.kind === "drink") {
    const volumeMl = amount(payload.volumeMl, 5000);
    const caloriesKcal = amount(payload.caloriesKcal, 2000);
    if (volumeMl === null || volumeMl < 1 || caloriesKcal === null) return null;
    const drinkType = typeof payload.drinkType === "string" && payload.drinkType.trim() !== "" ? payload.drinkType.trim() : name;
    return {
      id: row.id,
      name,
      kind: "drink",
      payload: {
        drinkType: drinkType.slice(0, 40),
        volumeMl: Math.round(volumeMl),
        caloriesKcal,
        caffeineMg: amount(payload.caffeineMg, 1000),
        hydrationMl: Math.min(Math.round(amount(payload.hydrationMl, 5000) ?? volumeMl), Math.round(volumeMl)),
        proteinG: amount(payload.proteinG, 300) ?? 0,
        carbsG: amount(payload.carbsG, 500) ?? 0,
        fatG: amount(payload.fatG, 300) ?? 0,
      },
    };
  }

  if (row.kind === "meal") {
    const rawItems = payload.items;
    if (!Array.isArray(rawItems)) return null;
    const items: MealItemValues[] = [];
    for (const entry of rawItems as unknown[]) {
      if (!isRecord(entry)) continue;
      const itemName = typeof entry.name === "string" ? entry.name.trim() : "";
      const caloriesKcal = amount(entry.caloriesKcal, 5000);
      if (itemName === "" || caloriesKcal === null) continue;
      const quantity = amount(entry.quantityG, 5000);
      items.push({
        name: itemName.slice(0, 80),
        quantityG: quantity !== null && quantity >= 1 ? quantity : null,
        caloriesKcal,
        proteinG: amount(entry.proteinG, 500) ?? 0,
        carbsG: amount(entry.carbsG, 1000) ?? 0,
        fatG: amount(entry.fatG, 500) ?? 0,
      });
    }
    if (items.length === 0) return null;
    const rawMealType = payload.mealType;
    const mealType = typeof rawMealType === "string" && MEAL_TYPES.includes(rawMealType) ? (rawMealType as MealType) : null;
    return { id: row.id, name, kind: "meal", payload: { mealType, items: items.slice(0, 20) } };
  }

  return null;
}

export function favoriteCalories(favorite: Favorite): number {
  if (favorite.kind === "drink") return favorite.payload.caloriesKcal;
  return favorite.payload.items.reduce((sum, item) => sum + item.caloriesKcal, 0);
}

export function favoriteProtein(favorite: Favorite): number {
  if (favorite.kind === "drink") return favorite.payload.proteinG;
  return favorite.payload.items.reduce((sum, item) => sum + item.proteinG, 0);
}

/** What to store when a meal is saved as a favorite. */
export function mealFavoritePayload(values: MealValues): FavoriteMealPayload {
  return { mealType: values.mealType, items: values.items.map((item) => ({ ...item })) };
}

/** What to store when a drink is saved as a favorite. */
export function drinkFavoritePayload(values: DrinkValues): FavoriteDrinkPayload {
  return {
    drinkType: values.drinkType,
    volumeMl: values.volumeMl,
    caloriesKcal: values.caloriesKcal,
    caffeineMg: values.caffeineMg,
    hydrationMl: values.hydrationMl,
    proteinG: values.proteinG,
    carbsG: values.carbsG,
    fatG: values.fatG,
  };
}

/** A new diary entry from a favorite, at the given time. */
export function mealFromFavorite(favorite: Extract<Favorite, { kind: "meal" }>, at: string): MealValues {
  return {
    name: favorite.name,
    mealType: favorite.payload.mealType,
    consumedAt: at,
    notes: null,
    items: favorite.payload.items.map((item) => ({ ...item })),
  };
}

export function drinkFromFavorite(favorite: Extract<Favorite, { kind: "drink" }>, at: string): DrinkValues {
  return { ...favorite.payload, consumedAt: at, notes: null };
}
