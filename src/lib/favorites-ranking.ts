// Which favorites to show first, in which time-of-day groups, and what was eaten recently.
// Pure code with relative imports, so it runs under `node --test`. Usage is read from the diary
// itself: an entry logged from a favorite keeps the favorite's name (and, for a drink, its type and volume).

import type { DrinkRow, FoodRow, MealItemValues, MealType } from "./day/entries.ts";
import type { Favorite } from "./favorites.ts";

export type TimeSlot = "morning" | "noon" | "evening";

export const SLOT_LABELS: Record<TimeSlot, string> = { morning: "בוקר", noon: "צהריים", evening: "ערב" };
export const SLOTS: TimeSlot[] = ["morning", "noon", "evening"];

/** Morning 04–11, noon 11–16, evening 16–04. */
export function slotOfHour(hour: number): TimeSlot {
  if (hour >= 4 && hour < 11) return "morning";
  if (hour >= 11 && hour < 16) return "noon";
  return "evening";
}

/** A diary entry, reduced to what is needed to match it to a favorite. */
export type HistoryEntry =
  | { kind: "meal"; name: string; at: Date }
  | { kind: "drink"; name: string; volumeMl: number; at: Date };

export type FavoriteUse = { favoriteId: string; at: Date };

function same(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** The diary entries that came from (or match) each favorite. */
export function matchUses(favorites: Favorite[], history: HistoryEntry[]): FavoriteUse[] {
  const uses: FavoriteUse[] = [];
  for (const entry of history) {
    const favorite = favorites.find((f) =>
      entry.kind === "meal"
        ? f.kind === "meal" && same(f.name, entry.name)
        : f.kind === "drink" && same(f.payload.drinkType, entry.name) && f.payload.volumeMl === entry.volumeMl,
    );
    if (favorite) uses.push({ favoriteId: favorite.id, at: entry.at });
  }
  return uses;
}

/** Uses older than this are ignored for ranking and grouping. */
export const USE_WINDOW_DAYS = 60;
/** A slot belongs to a favorite when at least this share of its uses fall in it. */
export const SLOT_SHARE = 0.25;

const DAY_MS = 86_400_000;

function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

function recentUses(uses: FavoriteUse[], favoriteId: string, now: Date): FavoriteUse[] {
  return uses.filter(
    (use) => use.favoriteId === favoriteId && now.getTime() - use.at.getTime() <= USE_WINDOW_DAYS * DAY_MS,
  );
}

/**
 * The time slots a favorite belongs to, from when it is actually eaten. Coffee drunk in the
 * morning and in the evening belongs to both. Empty when it was not used recently.
 */
export function favoriteSlots(uses: FavoriteUse[], favoriteId: string, now: Date): TimeSlot[] {
  const own = recentUses(uses, favoriteId, now);
  if (own.length === 0) return [];
  return SLOTS.filter((slot) => {
    const inSlot = own.filter((use) => slotOfHour(use.at.getHours()) === slot).length;
    return inSlot / own.length >= SLOT_SHARE;
  });
}

/**
 * How fitting a favorite is right now: recent uses count more, and uses near the current hour
 * count most. A favorite saved in the last two weeks gets a boost, so a new one shows up.
 */
export function favoriteScore(uses: FavoriteUse[], favoriteId: string, createdAt: Date | null, now: Date): number {
  const nowHour = hourOf(now);
  let score = 0;
  for (const use of recentUses(uses, favoriteId, now)) {
    const ageDays = (now.getTime() - use.at.getTime()) / DAY_MS;
    const raw = Math.abs(hourOf(use.at) - nowHour);
    const distance = Math.min(raw, 24 - raw);
    score += Math.exp(-ageDays / 30) * (0.25 + Math.exp(-((distance / 3) ** 2)));
  }
  if (createdAt) {
    const ageDays = (now.getTime() - createdAt.getTime()) / DAY_MS;
    if (ageDays >= 0 && ageDays < 14) score += 1.5 * Math.exp(-ageDays / 7);
  }
  return score;
}

/** Favorites ordered for the moment: best fit first; ties by name. */
export function rankFavorites(favorites: Favorite[], uses: FavoriteUse[], now: Date): Favorite[] {
  const scored = favorites.map((favorite) => ({
    favorite,
    score: favoriteScore(uses, favorite.id, favorite.createdAt ? new Date(favorite.createdAt) : null, now),
  }));
  scored.sort((a, b) => b.score - a.score || a.favorite.name.localeCompare(b.favorite.name, "he"));
  return scored.map((item) => item.favorite);
}

// ------------------------------------------------------------------ eaten recently

export type RecentEntry =
  | {
      key: string;
      kind: "meal";
      name: string;
      kcal: number;
      lastAt: Date;
      mealType: MealType | null;
      items: MealItemValues[];
    }
  | {
      key: string;
      kind: "drink";
      name: string;
      kcal: number;
      lastAt: Date;
      drink: Omit<DrinkRow, "id" | "consumed_at" | "notes">;
    };

export const RECENT_DAYS = 7;
export const RECENT_LIMIT = 8;

/** The title a meal shows in the diary. */
export function mealTitle(row: Pick<FoodRow, "name" | "items">): string {
  const name = row.name?.trim();
  if (name) return name;
  return row.items.map((item) => item.food_name).join(", ");
}

/**
 * Distinct meals and drinks from the last week, newest first, leaving out what is already a favorite.
 * Lets the user log "the same again" without saving everything as a favorite.
 */
export function recentEntries(foods: FoodRow[], drinks: DrinkRow[], favorites: Favorite[], now: Date): RecentEntry[] {
  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  const candidates: RecentEntry[] = [];
  for (const row of foods) {
    const at = new Date(row.consumed_at);
    if (at.getTime() < since || at.getTime() > now.getTime() || row.items.length === 0) continue;
    const name = mealTitle(row);
    if (name === "" || favorites.some((f) => f.kind === "meal" && same(f.name, name))) continue;
    candidates.push({
      key: `meal:${name}`,
      kind: "meal",
      name: name.slice(0, 80),
      kcal: row.items.reduce((sum, item) => sum + Number(item.calories_kcal), 0),
      lastAt: at,
      mealType: row.meal_type,
      items: row.items.map((item) => ({
        name: item.food_name,
        quantityG: item.quantity_unit === "g" && item.quantity !== null ? Number(item.quantity) : null,
        caloriesKcal: Number(item.calories_kcal),
        proteinG: Number(item.protein_g),
        carbsG: Number(item.carbs_g),
        fatG: Number(item.fat_g),
      })),
    });
  }
  for (const row of drinks) {
    const at = new Date(row.consumed_at);
    if (at.getTime() < since || at.getTime() > now.getTime()) continue;
    const volume = Number(row.volume_ml);
    if (favorites.some((f) => f.kind === "drink" && same(f.payload.drinkType, row.drink_type) && f.payload.volumeMl === volume)) {
      continue;
    }
    candidates.push({
      key: `drink:${row.drink_type.trim()}:${volume}`,
      kind: "drink",
      name: `${row.drink_type.trim()} (${volume} מ"ל)`,
      kcal: Number(row.calories_kcal),
      lastAt: at,
      drink: {
        drink_type: row.drink_type.trim(),
        volume_ml: volume,
        calories_kcal: Number(row.calories_kcal),
        caffeine_mg: row.caffeine_mg === null ? null : Number(row.caffeine_mg),
        hydration_ml: Number(row.hydration_ml),
        protein_g: Number(row.protein_g),
        carbs_g: Number(row.carbs_g),
        fat_g: Number(row.fat_g),
      },
    });
  }
  candidates.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  const seen = new Set<string>();
  const result: RecentEntry[] = [];
  for (const entry of candidates) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    result.push(entry);
    if (result.length >= RECENT_LIMIT) break;
  }
  return result;
}

/** Case- and space-tolerant search over names. */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return name.toLowerCase().includes(q);
}
