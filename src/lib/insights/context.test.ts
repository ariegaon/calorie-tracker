import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "./dataset.ts";
import { buildQuestionContext } from "./context.ts";
import type { DayData } from "../day/summary.ts";

// Synthetic rows; only the fields read are filled.
function food(name: string, kcal: number, meal: string): DayData["foods"][number] {
  return { id: name, consumed_at: "", name, meal_type: meal, source: "manual", notes: null, items: [{ food_name: name, calories_kcal: kcal, protein_g: 0, carbs_g: 0, fat_g: 0 }] } as unknown as DayData["foods"][number];
}

test("question context: no identifiers, meals per day, workouts that count, per-condition trends", () => {
  const range: { day: number; data: DayData | null }[] = [];
  for (let i = 0; i < 20; i += 1) {
    const weights =
      i % 2 === 0
        ? [{ weight_kg: 80 - 0.05 * i, measurement_conditions: "בוקר, לפני אוכל", measured_at: "" }]
        : [{ weight_kg: 80 - 0.05 * i - 0.7, measurement_conditions: "ערב, אחרי אימון", measured_at: "" }];
    const activities =
      i === 3
        ? [
            { activity_type: "ריצה", duration_seconds: 3600, calories_active_kcal: 600, calories_total_kcal: null, excluded_from_balance: false },
            { activity_type: "ריצה", duration_seconds: 3600, calories_active_kcal: 600, calories_total_kcal: null, excluded_from_balance: true },
          ]
        : [];
    range.push({
      day: 20000 + i,
      data: {
        foods: [food("שקשוקה", 450, "breakfast"), food("פסטה", 700, "dinner")],
        drinks: [],
        activities: activities as unknown as DayData["activities"],
        weights: weights as unknown as DayData["weights"],
      },
    });
  }
  const plan = { targetKcal: 1800, plannedWeeklyKg: -0.5, targetWeightKg: 74, targetDate: null, baselineKcal: 2300 };
  const dataset = buildDataset({ range, energy: { bmr: 1700, baselineKcal: 2300 }, snackAllowanceKcal: null, plan });
  const context = buildQuestionContext({ range, dataset, findings: [], bmr: 1700, snackAllowanceKcal: null, sex: "female" });

  const text = JSON.stringify(context);
  assert.ok(!text.includes("@"));
  assert.equal(context.address_user_as, "feminine");
  const days = context.days as { by_meal_kcal: Record<string, number> }[];
  assert.equal(days.length, 20);
  assert.deepEqual(days[0].by_meal_kcal, { breakfast: 450, dinner: 700 });
  assert.equal((context.workouts as unknown[]).length, 1); // the duplicate does not count
  const trends = context.trends as { by_weigh_in_condition: { condition: string; trend_kg_per_week: number }[]; condition_offsets: { offsets_kg_vs_reference: Record<string, number>; trend_with_offsets_removed_kg_per_week: number } };
  assert.equal(trends.by_weigh_in_condition.find((item) => item.condition === "ערב, אחרי אימון")?.trend_kg_per_week, -0.35);
  assert.equal(trends.condition_offsets.trend_with_offsets_removed_kg_per_week, -0.35);
  assert.equal(Math.abs(Object.values(trends.condition_offsets.offsets_kg_vs_reference)[0]), 0.7);
});
