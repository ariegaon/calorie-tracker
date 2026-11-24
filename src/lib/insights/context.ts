// The summary of the user's data that goes with a free question. Pure code.
// It holds no name, email or account id: dates, numbers, food names and workout types only.
// Figures that need real calculation (trends, offsets, findings) are computed here, so the model
// quotes them instead of working them out.

import { activeCaloriesForActivity } from "../calculations/energy.ts";
import type { DayData } from "../day/summary.ts";
import { dailyWeights, dateOfDay, fitTrend } from "../weight/trend.ts";
import { fitWithConditionOffsets, type Finding } from "./analyses.ts";
import { compositionSignal } from "../weight/composition.ts";
import type { InsightDataset } from "./dataset.ts";

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

function dateLabel(day: number): string {
  const date = dateOfDay(day);
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

const r = (value: number, digits = 0) => Number(value.toFixed(digits));

function slopePerWeek(points: { day: number; weightKg: number }[]): number | null {
  if (points.length < 4) return null;
  const span = points[points.length - 1].day - points[0].day;
  if (span < 10) return null;
  const mx = points.reduce((sum, point) => sum + point.day, 0) / points.length;
  const my = points.reduce((sum, point) => sum + point.weightKg, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  for (const point of points) {
    sxx += (point.day - mx) ** 2;
    sxy += (point.day - mx) * (point.weightKg - my);
  }
  return sxx === 0 ? null : (sxy / sxx) * 7;
}

export type QuestionContext = Record<string, unknown>;

export function buildQuestionContext(input: {
  range: { day: number; data: DayData | null }[];
  dataset: InsightDataset;
  findings: Finding[];
  bmr: number;
  snackAllowanceKcal: number | null;
  sex: "male" | "female" | null;
}): QuestionContext {
  const { dataset } = input;
  const byDay = new Map(dataset.days.map((day) => [day.day, day]));

  const days: Record<string, unknown>[] = [];
  const workouts: Record<string, unknown>[] = [];
  for (const { day, data } of input.range) {
    const summary = byDay.get(day);
    if (!data || !summary) continue;
    const byMeal: Record<string, number> = {};
    for (const food of data.foods) {
      const meal = MEALS.includes(food.meal_type as (typeof MEALS)[number]) ? (food.meal_type as string) : "other";
      const kcal = food.items.reduce((sum, item) => sum + Number(item.calories_kcal), 0);
      byMeal[meal] = r((byMeal[meal] ?? 0) + kcal);
    }
    for (const activity of data.activities) {
      const kcal = activeCaloriesForActivity(
        {
          caloriesActiveKcal: activity.calories_active_kcal === null ? null : Number(activity.calories_active_kcal),
          caloriesTotalKcal: activity.calories_total_kcal === null ? null : Number(activity.calories_total_kcal),
          durationSeconds: activity.duration_seconds === null ? null : Number(activity.duration_seconds),
          excludedFromBalance: activity.excluded_from_balance,
        },
        input.bmr,
      ).kcal;
      if (activity.excluded_from_balance) continue;
      workouts.push({
        date: dateLabel(day),
        type: activity.activity_type,
        minutes: activity.duration_seconds === null ? null : Math.round(Number(activity.duration_seconds) / 60),
        active_kcal: r(kcal),
      });
    }
    if (!summary.logged && summary.workoutKcal === 0) continue;
    days.push({
      date: dateLabel(day),
      weekday: WEEKDAYS[summary.weekday],
      logged: summary.logged,
      intake_kcal: r(summary.intakeKcal),
      workout_kcal: r(summary.workoutKcal),
      entries: summary.entries,
      ...(summary.tags.length > 0 ? { tags: summary.tags } : {}),
      ...(summary.logged ? { by_meal_kcal: byMeal } : {}),
    });
  }

  const logged = dataset.days.filter((day) => day.logged).length;
  const weighIns = dataset.weighIns.map((weighIn) => ({
    date: dateLabel(weighIn.day),
    kg: weighIn.weightKg,
    condition: weighIn.condition ?? "לא צוין",
  }));

  // Trends computed here: overall (28 days), per weigh-in condition, and the offsets between conditions.
  const daily = dailyWeights(dataset.weighIns.map((weighIn) => ({ at: dateOfDay(weighIn.day).toISOString(), weightKg: weighIn.weightKg })));
  const overall = fitTrend(daily, dataset.lastDay);
  const byCondition = new Map<string, { day: number; weightKg: number }[]>();
  for (const weighIn of dataset.weighIns) {
    if (!weighIn.condition) continue;
    const list = byCondition.get(weighIn.condition) ?? [];
    list.push({ day: weighIn.day, weightKg: weighIn.weightKg });
    byCondition.set(weighIn.condition, list);
  }
  const conditionTrends: Record<string, unknown>[] = [];
  for (const [condition, points] of byCondition) {
    const sorted = [...points].sort((a, b) => a.day - b.day);
    const slope = slopePerWeek(sorted);
    conditionTrends.push({
      condition,
      weigh_ins: sorted.length,
      trend_kg_per_week: slope === null ? "not enough data (needs 4 weigh-ins over 10 days)" : r(slope, 2),
    });
  }
  const used = [...byCondition.entries()].filter(([, points]) => points.length >= 3).sort((a, b) => b[1].length - a[1].length);
  let conditionOffsets: Record<string, unknown> | null = null;
  if (used.length >= 2) {
    const points = used.flatMap(([condition, list]) => list.map((point) => ({ ...point, condition })));
    points.sort((a, b) => a.day - b.day);
    const fit = fitWithConditionOffsets(points, used[0][0]);
    if (fit) {
      conditionOffsets = {
        reference: used[0][0],
        offsets_kg_vs_reference: Object.fromEntries([...fit.offsets].map(([condition, kg]) => [condition, r(kg, 2)])),
        trend_with_offsets_removed_kg_per_week: r(fit.slopeKgPerDay * 7, 2),
      };
    }
  }

  return {
    period: `${dateLabel(dataset.firstDay)} – ${dateLabel(dataset.lastDay)}`,
    address_user_as: input.sex === "female" ? "feminine" : "masculine",
    plan: {
      daily_target_kcal_without_workouts: r(dataset.plan.targetKcal),
      planned_change_kg_per_week: r(dataset.plan.plannedWeeklyKg, 2),
      target_weight_kg: dataset.plan.targetWeightKg,
      target_date: dataset.plan.targetDate,
      everyday_expenditure_kcal: r(dataset.plan.baselineKcal),
      unlogged_snack_allowance_kcal: input.snackAllowanceKcal ?? 0,
      workouts_add_to_daily_allowance: true,
    },
    logged_days: logged,
    days,
    top_items_by_calories: dataset.items.slice(0, 25).map((item) => ({
      name: item.name,
      total_kcal: r(item.totalKcal),
      days_eaten: item.days,
      kcal_per_logged_day: logged > 0 ? r(item.totalKcal / logged) : 0,
    })),
    weigh_ins: weighIns,
    workouts,
    body_measurements: dataset.measurements
      .filter((point) => point.day > dataset.lastDay - 90)
      .sort((a, b) => a.day - b.day)
      .map((point) => ({ date: dateLabel(point.day), waist_cm: point.waistCm, body_fat_percent: point.bodyFatPercent })),
    second_signal: (() => {
      const signal = compositionSignal(dataset.measurements, dataset.lastDay);
      const trend = signal.source === "waist" ? signal.waist : signal.bodyFat;
      return {
        verdict: signal.verdict,
        source: signal.source,
        change_over_window: trend ? r(trend.change, 1) : null,
        weeks: trend ? Math.round(trend.spanDays / 7) : null,
        note: "computed by the app; a 1 cm waist (or 1 point body fat) change over 3+ weeks is needed to count",
      };
    })(),
    trends: {
      overall_last_28_days_kg_per_week: overall ? r(overall.slopeKgPerDay * 7, 2) : "not enough data",
      by_weigh_in_condition: conditionTrends,
      condition_offsets: conditionOffsets ?? "needs at least two conditions with 3 weigh-ins each",
    },
    findings: input.findings.map((finding) => ({ kind: finding.kind, facts: finding.facts })),
  };
}
