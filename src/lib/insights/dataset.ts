// The facts the insight analyses work on, built from the rows of a range of days. Pure code.

import { summarizeDay, type DayData } from "../day/summary.ts";
import { dateOfDay } from "../weight/trend.ts";

export type InsightDay = {
  day: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** Food was logged on this day; days without food are left out of every intake figure. */
  logged: boolean;
  /** Number of food entries (meals or single foods) logged. */
  entries: number;
  /** Food + drinks + the unlogged-snack allowance, as the balance counts it. */
  intakeKcal: number;
  /** Active calories of the workouts that count. */
  workoutKcal: number;
  /** The user's day tags marked on this day. */
  tags: string[];
};

export type InsightWeighIn = { day: number; weightKg: number; condition: string | null };

export type ItemTotal = {
  name: string;
  totalKcal: number;
  /** Different days the item appeared on. */
  days: number;
};

export type InsightPlan = {
  /** Daily intake target on a day without workouts. */
  targetKcal: number;
  /** Weekly change the plan aims for (negative = loss). */
  plannedWeeklyKg: number;
  targetWeightKg: number | null;
  /** yyyy-mm-dd, when the plan is by date. */
  targetDate: string | null;
  /** Everyday expenditure without workouts. */
  baselineKcal: number;
};

export type InsightDataset = {
  firstDay: number;
  lastDay: number;
  days: InsightDay[];
  weighIns: InsightWeighIn[];
  items: ItemTotal[];
  plan: InsightPlan;
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function buildDataset(input: {
  range: { day: number; data: DayData | null }[];
  energy: { bmr: number; baselineKcal: number };
  snackAllowanceKcal: number | null;
  plan: InsightPlan;
  /** Day tags by day number. */
  tagsByDay?: Map<number, string[]>;
}): InsightDataset {
  const days: InsightDay[] = [];
  const weighIns: InsightWeighIn[] = [];
  const items = new Map<string, { totalKcal: number; days: Set<number> }>();

  const addItem = (rawName: string, kcal: number, day: number) => {
    const name = normalizeName(rawName);
    if (name === "" || !Number.isFinite(kcal) || kcal <= 0) return;
    const entry = items.get(name) ?? { totalKcal: 0, days: new Set<number>() };
    entry.totalKcal += kcal;
    entry.days.add(day);
    items.set(name, entry);
  };

  for (const { day, data } of input.range) {
    const weekday = dateOfDay(day).getDay();
    const tags = input.tagsByDay?.get(day) ?? [];
    if (!data) {
      days.push({ day, weekday, logged: false, entries: 0, intakeKcal: 0, workoutKcal: 0, tags });
      continue;
    }
    const summary = summarizeDay(data, input.energy, input.snackAllowanceKcal);
    const logged = data.foods.length > 0;
    days.push({
      day,
      weekday,
      logged,
      entries: data.foods.length,
      intakeKcal: logged ? summary.foodKcal + summary.drinkKcal + summary.snackKcal : 0,
      workoutKcal: summary.activity.activeKcal,
      tags,
    });
    if (logged) {
      for (const food of data.foods) for (const item of food.items) addItem(item.food_name, Number(item.calories_kcal), day);
      for (const drink of data.drinks) addItem(drink.drink_type, Number(drink.calories_kcal), day);
    }
    for (const weight of data.weights) {
      const kg = Number(weight.weight_kg);
      if (Number.isFinite(kg)) weighIns.push({ day, weightKg: kg, condition: weight.measurement_conditions ?? null });
    }
  }

  return {
    firstDay: input.range.length > 0 ? input.range[0].day : 0,
    lastDay: input.range.length > 0 ? input.range[input.range.length - 1].day : 0,
    days,
    weighIns,
    items: [...items.entries()]
      .map(([name, entry]) => ({ name, totalKcal: entry.totalKcal, days: entry.days.size }))
      .sort((a, b) => b.totalKcal - a.totalKcal),
    plan: input.plan,
  };
}
