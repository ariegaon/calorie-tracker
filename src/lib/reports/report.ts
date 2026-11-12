// Weekly and monthly reports, CSV export and the home screen's gentle reminders. Pure code.

import { activeCaloriesForActivity } from "../calculations/energy.ts";
import { MEAL_TYPE_LABELS } from "../day/entries.ts";
import { summarizeDay, type DayData } from "../day/summary.ts";

const KCAL_PER_KG = 7700;

// ------------------------------------------------------------------ report

export type ReportDay = {
  day: number;
  /** False when no food was logged: the day is shown but left out of the averages. */
  documented: boolean;
  consumedKcal: number;
  burnedKcal: number;
  balanceKcal: number;
  proteinG: number;
  hydrationMl: number;
};

export type ActivityTypeSummary = { type: string; count: number; seconds: number; activeKcal: number };

export type Report = {
  totalDays: number;
  documentedDays: number;
  averageConsumedKcal: number | null;
  averageBurnedKcal: number | null;
  averageBalanceKcal: number | null;
  averageProteinG: number | null;
  cumulativeBalanceKcal: number;
  theoreticalChangeKg: number;
  /** Days that met the goal, out of the documented days. Null when no goal is set. */
  proteinGoalDays: number | null;
  /** Days that met the goal, out of all days in the range. */
  waterGoalDays: number;
  activityCount: number;
  activitySeconds: number;
  activeKcal: number;
  byActivityType: ActivityTypeSummary[];
  /** Change in the 7-day moving average across the range. Null without at least two weigh days. */
  weightChangeKg: number | null;
  perDay: ReportDay[];
};

export function buildReport(input: {
  days: { day: number; data: DayData | null }[];
  energy: { bmr: number; baselineKcal: number } | null;
  proteinGoalG: number | null;
  waterGoalMl: number;
  /** Moving-average points, oldest first. Only those inside the range are used. */
  weightAverage: { day: number; value: number }[];
}): Report {
  const perDay: ReportDay[] = [];
  const types = new Map<string, ActivityTypeSummary>();
  let activityCount = 0;
  let activitySeconds = 0;
  let activeKcal = 0;
  let proteinGoalDays = 0;
  let waterGoalDays = 0;

  const empty: DayData = { foods: [], drinks: [], activities: [], weights: [] };
  for (const { day, data } of input.days) {
    const dayData = data ?? empty;
    const summary = summarizeDay(dayData, input.energy);
    const consumed = summary.foodKcal + summary.drinkKcal;
    const burned = (input.energy?.baselineKcal ?? 0) + summary.activity.activeKcal;
    perDay.push({
      day,
      documented: summary.hasFood,
      consumedKcal: consumed,
      burnedKcal: burned,
      balanceKcal: consumed - burned,
      proteinG: summary.proteinG,
      hydrationMl: summary.hydrationMl,
    });

    if (summary.hasFood && input.proteinGoalG !== null && summary.proteinG >= input.proteinGoalG) proteinGoalDays += 1;
    if (input.waterGoalMl > 0 && summary.hydrationMl >= input.waterGoalMl) waterGoalDays += 1;

    for (const activity of dayData.activities) {
      if (activity.excluded_from_balance) continue;
      const kcal = activeCaloriesForActivity(
        {
          caloriesActiveKcal: activity.calories_active_kcal === null ? null : Number(activity.calories_active_kcal),
          caloriesTotalKcal: activity.calories_total_kcal === null ? null : Number(activity.calories_total_kcal),
          durationSeconds: activity.duration_seconds === null ? null : Number(activity.duration_seconds),
        },
        input.energy?.bmr ?? 0,
      ).kcal;
      const seconds = Number(activity.duration_seconds ?? 0);
      activityCount += 1;
      activitySeconds += seconds;
      activeKcal += kcal;
      const entry = types.get(activity.activity_type) ?? { type: activity.activity_type, count: 0, seconds: 0, activeKcal: 0 };
      entry.count += 1;
      entry.seconds += seconds;
      entry.activeKcal += kcal;
      types.set(activity.activity_type, entry);
    }
  }

  const documented = perDay.filter((d) => d.documented);
  const mean = (pick: (d: ReportDay) => number) =>
    documented.length > 0 ? documented.reduce((sum, d) => sum + pick(d), 0) / documented.length : null;
  const hasEnergy = input.energy !== null;
  const cumulative = hasEnergy ? documented.reduce((sum, d) => sum + d.balanceKcal, 0) : 0;

  const firstDay = input.days.length > 0 ? input.days[0].day : 0;
  const lastDay = input.days.length > 0 ? input.days[input.days.length - 1].day : 0;
  const inRange = input.weightAverage.filter((p) => p.day >= firstDay && p.day <= lastDay);

  return {
    totalDays: perDay.length,
    documentedDays: documented.length,
    averageConsumedKcal: mean((d) => d.consumedKcal),
    averageBurnedKcal: hasEnergy ? mean((d) => d.burnedKcal) : null,
    averageBalanceKcal: hasEnergy ? mean((d) => d.balanceKcal) : null,
    averageProteinG: mean((d) => d.proteinG),
    cumulativeBalanceKcal: cumulative,
    theoreticalChangeKg: cumulative / KCAL_PER_KG,
    proteinGoalDays: input.proteinGoalG === null ? null : proteinGoalDays,
    waterGoalDays,
    activityCount,
    activitySeconds,
    activeKcal,
    byActivityType: [...types.values()].sort((a, b) => b.seconds - a.seconds || a.type.localeCompare(b.type)),
    weightChangeKg: inRange.length >= 2 ? inRange[inRange.length - 1].value - inRange[0].value : null,
    perDay,
  };
}

// ------------------------------------------------------------------ CSV

export type CsvCell = string | number | null;

function csvCell(value: CsvCell): string {
  if (value === null) return "";
  let text = typeof value === "number" ? String(value) : value;
  // Spreadsheet programs run cells that start with these characters as formulas.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text with a byte-order mark, so Excel reads Hebrew correctly. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const EXPORT_HEADERS = [
  "תאריך",
  "שעה",
  "סוג",
  "שם",
  "כמות",
  "יחידה",
  'קלוריות (קק"ל)',
  "חלבון (ג')",
  "פחמימות (ג')",
  "שומן (ג')",
  "פרטים",
  "מקור",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateAndTime(iso: string): [string, string] {
  const d = new Date(iso);
  return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`];
}

/** One row per food item, drink, activity and weigh-in, oldest first. */
export function exportRows(days: DayData[]): CsvCell[][] {
  const rows: { at: number; cells: CsvCell[] }[] = [];
  const push = (iso: string, cells: CsvCell[]) => rows.push({ at: new Date(iso).getTime(), cells: [...dateAndTime(iso), ...cells] });

  for (const day of days) {
    for (const food of day.foods) {
      const meal = food.meal_type ? MEAL_TYPE_LABELS[food.meal_type] : "";
      for (const item of food.items) {
        push(food.consumed_at, [
          "מזון",
          item.food_name,
          item.quantity === null ? null : Number(item.quantity),
          item.quantity === null ? null : "גרם",
          Number(item.calories_kcal),
          Number(item.protein_g),
          Number(item.carbs_g),
          Number(item.fat_g),
          [food.name && food.name !== item.food_name ? food.name : "", meal].filter(Boolean).join(" · "),
          item.source === "ai_estimate" ? (item.user_corrected ? "הערכת AI, תוקן" : "הערכת AI") : "הזנה ידנית",
        ]);
      }
    }
    for (const drink of day.drinks) {
      push(drink.consumed_at, [
        "משקה",
        drink.drink_type,
        Number(drink.volume_ml),
        'מ"ל',
        Number(drink.calories_kcal),
        Number(drink.protein_g ?? 0),
        Number(drink.carbs_g ?? 0),
        Number(drink.fat_g ?? 0),
        drink.caffeine_mg === null ? "" : `קפאין ${Number(drink.caffeine_mg)} מ"ג`,
        "הזנה ידנית",
      ]);
    }
    for (const activity of day.activities) {
      const details = [
        activity.distance_m === null ? "" : `${(Number(activity.distance_m) / 1000).toFixed(2)} ק"מ`,
        activity.excluded_from_balance ? "לא נספר במאזן" : "",
      ];
      push(activity.started_at, [
        "פעילות",
        activity.activity_type,
        activity.duration_seconds === null ? null : Math.round(Number(activity.duration_seconds) / 60),
        activity.duration_seconds === null ? null : "דקות",
        activity.calories_active_kcal === null ? null : -Number(activity.calories_active_kcal),
        null,
        null,
        null,
        details.filter(Boolean).join(" · "),
        activity.external_provider ?? "הזנה ידנית",
      ]);
    }
    for (const weight of day.weights) {
      push(weight.measured_at, [
        "שקילה",
        "משקל",
        Number(weight.weight_kg),
        'ק"ג',
        null,
        null,
        null,
        null,
        weight.measurement_conditions ?? "",
        weight.source === "manual" ? "הזנה ידנית" : weight.source,
      ]);
    }
  }

  return rows.sort((a, b) => a.at - b.at).map((row) => row.cells);
}

// ------------------------------------------------------------------ reminders on the home screen

export type Insight = { key: "weigh_in" | "yesterday_food" | "hydration" | "protein"; text: string };

const MS_PER_DAY = 86_400_000;
export const WEIGH_IN_REMINDER_DAYS = 4;

/**
 * Short, factual reminders for today. They state what is missing and why it matters,
 * and never push toward eating less or exercising to compensate.
 */
export function buildInsights(input: {
  now: Date;
  lastWeighInAt: string | null;
  previousDayHasFood: boolean | null;
  hasFoodToday: boolean;
  hydrationMl: number;
  waterGoalMl: number;
  proteinG: number;
  proteinGoalG: number | null;
}): Insight[] {
  const insights: Insight[] = [];
  const hour = input.now.getHours();

  if (input.lastWeighInAt === null) {
    insights.push({ key: "weigh_in", text: "עוד לא נרשמה שקילה. שקילות סדירות הן הבסיס למגמה ולתחזית." });
  } else {
    const days = Math.floor((input.now.getTime() - new Date(input.lastWeighInAt).getTime()) / MS_PER_DAY);
    if (days >= WEIGH_IN_REMINDER_DAYS) {
      insights.push({ key: "weigh_in", text: `השקילה האחרונה הייתה לפני ${days} ימים. שקילה חדשה תעדכן את המגמה.` });
    }
  }

  if (input.previousDayHasFood === false) {
    insights.push({
      key: "yesterday_food",
      text: "אתמול לא נרשם מזון. ימים בלי רישום לא נכנסים לחישוב המאזן, אז אפשר להשלים אותם בדיעבד.",
    });
  }

  if (hour >= 18 && input.waterGoalMl > 0 && input.hydrationMl < input.waterGoalMl * 0.7) {
    insights.push({
      key: "hydration",
      text: `עד עכשיו נרשמו ${Math.round(input.hydrationMl)} מ"ל שתייה מתוך יעד של ${Math.round(input.waterGoalMl)} מ"ל.`,
    });
  }

  if (
    hour >= 20 &&
    input.hasFoodToday &&
    input.proteinGoalG !== null &&
    input.proteinGoalG > 0 &&
    input.proteinG < input.proteinGoalG * 0.8
  ) {
    insights.push({
      key: "protein",
      text: `החלבון היום: ${Math.round(input.proteinG)} גרם מתוך יעד של ${Math.round(input.proteinGoalG)} גרם.`,
    });
  }

  return insights;
}
