// Turns a day's rows into totals, a calorie balance and a chronological timeline. Pure code.

import {
  activeCaloriesForActivity,
  dailyBalance,
  sumActiveCalories,
  type DailyBalance,
  type DayActivitySummary,
} from "../calculations/energy.ts";
import type { ActivityRow, DrinkRow, FoodRow, WeightRow } from "./entries.ts";
import { MEAL_TYPE_LABELS } from "./entries.ts";

export type DayData = {
  foods: FoodRow[];
  drinks: DrinkRow[];
  activities: ActivityRow[];
  weights: WeightRow[];
};

export type DaySummary = {
  foodKcal: number;
  drinkKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  hydrationMl: number;
  caffeineMg: number;
  activity: DayActivitySummary;
  /** Null when the profile is missing what the expenditure estimate needs. */
  balance: DailyBalance | null;
  /** False while no food was logged: the balance is then not meaningful yet. */
  hasFood: boolean;
};

function toActivityCalories(row: ActivityRow) {
  return {
    caloriesActiveKcal: row.calories_active_kcal === null ? null : Number(row.calories_active_kcal),
    caloriesTotalKcal: row.calories_total_kcal === null ? null : Number(row.calories_total_kcal),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    excludedFromBalance: row.excluded_from_balance,
  };
}

export function summarizeDay(data: DayData, energy: { bmr: number; baselineKcal: number } | null): DaySummary {
  let foodKcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const food of data.foods) {
    for (const item of food.items) {
      foodKcal += Number(item.calories_kcal);
      proteinG += Number(item.protein_g);
      carbsG += Number(item.carbs_g);
      fatG += Number(item.fat_g);
    }
  }

  let drinkKcal = 0;
  let hydrationMl = 0;
  let caffeineMg = 0;
  for (const drink of data.drinks) {
    drinkKcal += Number(drink.calories_kcal);
    proteinG += Number(drink.protein_g ?? 0);
    carbsG += Number(drink.carbs_g ?? 0);
    fatG += Number(drink.fat_g ?? 0);
    hydrationMl += Number(drink.hydration_ml);
    caffeineMg += Number(drink.caffeine_mg ?? 0);
  }

  // Without a BMR the resting share of total-only workouts cannot be removed, so 0 is used
  // and no balance is reported.
  const activity = sumActiveCalories(data.activities.map(toActivityCalories), energy?.bmr ?? 0);

  const balance = energy
    ? dailyBalance({ foodKcal, drinkKcal, baselineKcal: energy.baselineKcal, activeKcal: activity.activeKcal })
    : null;

  return {
    foodKcal,
    drinkKcal,
    proteinG,
    carbsG,
    fatG,
    hydrationMl,
    caffeineMg,
    activity,
    balance,
    hasFood: data.foods.length > 0,
  };
}

export type TimelineKind = "food" | "drink" | "activity" | "weight";

export type TimelineEvent = {
  key: string;
  kind: TimelineKind;
  id: string;
  at: string;
  title: string;
  detail: string;
  /** Calories eaten or drunk (positive) or burned in a workout (negative). Null when not relevant. */
  kcal: number | null;
};

function minutes(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${Math.round(seconds / 60)} דק'`;
}

function kilometers(meters: number | null): string | null {
  if (meters === null || Number(meters) <= 0) return null;
  return `${(Number(meters) / 1000).toFixed(1)} ק"מ`;
}

export function buildTimeline(data: DayData, bmr: number | null): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const food of data.foods) {
    const kcal = food.items.reduce((sum, item) => sum + Number(item.calories_kcal), 0);
    const protein = food.items.reduce((sum, item) => sum + Number(item.protein_g), 0);
    const title = food.name ?? food.items.map((item) => item.food_name).join(", ");
    const parts = [food.meal_type ? MEAL_TYPE_LABELS[food.meal_type] : null, protein > 0 ? `${Math.round(protein)} גרם חלבון` : null];
    events.push({
      key: `food-${food.id}`,
      kind: "food",
      id: food.id,
      at: food.consumed_at,
      title: title === "" ? "ארוחה" : title,
      detail: parts.filter(Boolean).join(" · "),
      kcal,
    });
  }

  for (const drink of data.drinks) {
    events.push({
      key: `drink-${drink.id}`,
      kind: "drink",
      id: drink.id,
      at: drink.consumed_at,
      title: drink.drink_type,
      detail:
        `${drink.volume_ml} מ"ל` + (Number(drink.protein_g ?? 0) > 0 ? ` · ${Math.round(Number(drink.protein_g))} גרם חלבון` : ""),
      kcal: Number(drink.calories_kcal),
    });
  }

  for (const activity of data.activities) {
    const result = activeCaloriesForActivity(toActivityCalories(activity), bmr ?? 0);
    const parts = [minutes(activity.duration_seconds), kilometers(activity.distance_m)];
    if (result.method === "excluded") parts.push("לא נספר (כפילות)");
    if (result.method === "total_not_separable") parts.push("קלוריות לא נספרו: חסר משך");
    const counted = result.method === "active_reported" || result.method === "total_minus_resting";
    events.push({
      key: `activity-${activity.id}`,
      kind: "activity",
      id: activity.id,
      at: activity.started_at,
      title: activity.activity_type,
      detail: parts.filter(Boolean).join(" · "),
      kcal: counted ? -result.kcal : null,
    });
  }

  for (const weight of data.weights) {
    events.push({
      key: `weight-${weight.id}`,
      kind: "weight",
      id: weight.id,
      at: weight.measured_at,
      title: `שקילה: ${Number(weight.weight_kg)} ק"ג`,
      detail: weight.measurement_conditions ?? "",
      kcal: null,
    });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
