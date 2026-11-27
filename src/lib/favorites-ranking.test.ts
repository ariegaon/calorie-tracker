import { test } from "node:test";
import assert from "node:assert/strict";
import type { Favorite } from "./favorites.ts";
import type { DrinkRow, FoodRow } from "./day/entries.ts";
import {
  favoriteSlots,
  matchUses,
  matchesQuery,
  rankFavorites,
  recentEntries,
  slotOfHour,
  type HistoryEntry,
} from "./favorites-ranking.ts";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0);
const NOW_MORNING = at(27, 8);
const NOW_EVENING = at(27, 20);

const meal = (id: string, name: string, createdAt: string | null = null) =>
  ({ id, name, kind: "meal", payload: { mealType: null, items: [] }, createdAt }) as Favorite & { createdAt: string | null };
const coffee = {
  id: "coffee",
  name: "קפה הפוך",
  kind: "drink",
  payload: { drinkType: "קפה הפוך", volumeMl: 250, caloriesKcal: 120, caffeineMg: 80, hydrationMl: 250, proteinG: 6, carbsG: 9, fatG: 6 },
  createdAt: null,
} as Favorite & { createdAt: string | null };

const favorites = [meal("omelet", "חביתה וסלט"), meal("schnitzel", "שניצל ואורז"), coffee];

// Omelet in the mornings, schnitzel at noon, coffee both morning and evening.
const history: HistoryEntry[] = [
  ...[20, 21, 22, 23, 24, 25, 26].map((d) => ({ kind: "meal" as const, name: "חביתה וסלט", at: at(d, 7) })),
  ...[21, 23, 25].map((d) => ({ kind: "meal" as const, name: "שניצל ואורז", at: at(d, 13) })),
  ...[22, 23, 24, 25, 26].map((d) => ({ kind: "drink" as const, name: "קפה הפוך", volumeMl: 250, at: at(d, 8) })),
  ...[22, 23, 24, 25].map((d) => ({ kind: "drink" as const, name: "קפה הפוך", volumeMl: 250, at: at(d, 21) })),
  { kind: "drink", name: "קפה הפוך", volumeMl: 400, at: at(26, 10) }, // a different size is not this favorite
];

test("slots: morning 4–11, noon 11–16, evening otherwise", () => {
  assert.equal(slotOfHour(4), "morning");
  assert.equal(slotOfHour(10), "morning");
  assert.equal(slotOfHour(11), "noon");
  assert.equal(slotOfHour(16), "evening");
  assert.equal(slotOfHour(2), "evening");
});

test("uses match by meal name, and by drink type and volume", () => {
  const uses = matchUses(favorites, history);
  assert.equal(uses.filter((u) => u.favoriteId === "omelet").length, 7);
  assert.equal(uses.filter((u) => u.favoriteId === "coffee").length, 9);
});

test("a favorite eaten both morning and evening belongs to both groups", () => {
  const uses = matchUses(favorites, history);
  assert.deepEqual(favoriteSlots(uses, "coffee", NOW_MORNING), ["morning", "evening"]);
  assert.deepEqual(favoriteSlots(uses, "omelet", NOW_MORNING), ["morning"]);
  assert.deepEqual(favoriteSlots(uses, "schnitzel", NOW_MORNING), ["noon"]);
  assert.deepEqual(favoriteSlots([], "schnitzel", NOW_MORNING), []);
});

test("ranking follows the hour: omelet first in the morning, coffee first in the evening", () => {
  const uses = matchUses(favorites, history);
  assert.deepEqual(rankFavorites(favorites, uses, NOW_MORNING).map((f) => f.id).slice(0, 2).sort(), ["coffee", "omelet"]);
  assert.equal(rankFavorites(favorites, uses, NOW_EVENING)[0].id, "coffee");
  assert.equal(rankFavorites(favorites, uses, at(27, 13))[0].id, "schnitzel");
});

test("a favorite saved this week shows up even before it was used", () => {
  const fresh = meal("fresh", "סלט קינואה", at(26, 9).toISOString());
  const stale = meal("stale", "פשטידה");
  const all = [...favorites, fresh, stale];
  const uses = matchUses(all, [...history, { kind: "meal", name: "פשטידה", at: new Date(2026, 9, 10, 13, 0) }]);
  const ids = rankFavorites(all, uses, at(27, 13)).map((f) => f.id);
  assert.ok(ids.indexOf("fresh") < ids.indexOf("stale"));
  assert.equal(ids[ids.length - 1], "stale");
});

test("recent entries: distinct, newest first, last week only, favorites left out", () => {
  const item = (id: string, entryId: string, name: string, kcal: number) => ({
    id,
    food_entry_id: entryId,
    food_name: name,
    quantity: 100,
    quantity_unit: "g" as const,
    calories_kcal: kcal,
    protein_g: 10,
    carbs_g: 10,
    fat_g: 5,
  });
  const foods: FoodRow[] = [
    { id: "a", consumed_at: at(26, 13).toISOString(), name: "פסטה ברוטב", meal_type: "lunch", source: "manual", notes: null, items: [item("1", "a", "פסטה", 450)] },
    { id: "b", consumed_at: at(24, 13).toISOString(), name: "פסטה ברוטב", meal_type: "lunch", source: "manual", notes: null, items: [item("2", "b", "פסטה", 450)] },
    { id: "c", consumed_at: at(25, 7).toISOString(), name: "חביתה וסלט", meal_type: null, source: "manual", notes: null, items: [item("3", "c", "חביתה", 300)] },
    { id: "d", consumed_at: at(10, 7).toISOString(), name: "ישן", meal_type: null, source: "manual", notes: null, items: [item("4", "d", "ישן", 100)] },
    { id: "e", consumed_at: at(27, 7).toISOString(), name: null, meal_type: null, source: "ai_photo", notes: null, items: [item("5", "e", "יוגורט", 150), item("6", "e", "גרנולה", 120)] },
  ];
  const drinks: DrinkRow[] = [
    { id: "x", consumed_at: at(26, 8).toISOString(), drink_type: "קפה הפוך", volume_ml: 250, calories_kcal: 120, caffeine_mg: 80, hydration_ml: 250, protein_g: 6, carbs_g: 9, fat_g: 6, notes: null },
    { id: "y", consumed_at: at(26, 16).toISOString(), drink_type: "מיץ תפוזים", volume_ml: 200, calories_kcal: 90, caffeine_mg: null, hydration_ml: 200, protein_g: 1, carbs_g: 20, fat_g: 0, notes: null },
  ];
  const recent = recentEntries(foods, drinks, favorites, NOW_MORNING);
  assert.deepEqual(
    recent.map((r) => r.name),
    ["יוגורט, גרנולה", 'מיץ תפוזים (200 מ"ל)', "פסטה ברוטב"],
  );
  const pasta = recent.find((r) => r.name === "פסטה ברוטב");
  assert.ok(pasta && pasta.kind === "meal" && pasta.items[0].quantityG === 100 && pasta.kcal === 450);
});

test("search ignores case and surrounding spaces", () => {
  assert.equal(matchesQuery("Coffee Latte", " latte "), true);
  assert.equal(matchesQuery("קפה הפוך", "הפו"), true);
  assert.equal(matchesQuery("קפה הפוך", "תה"), false);
});
