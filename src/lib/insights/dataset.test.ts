import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "./dataset.ts";
import type { DayData } from "../day/summary.ts";

// Synthetic rows; only the fields the dataset reads are filled.
function food(name: string, kcal: number): DayData["foods"][number] {
  return { id: name, consumed_at: "", name, meal_type: null, source: "manual", notes: null, items: [{ food_name: name, calories_kcal: kcal, protein_g: 0, carbs_g: 0, fat_g: 0 }] } as unknown as DayData["foods"][number];
}

test("dataset: intake, recurring items, weigh-ins with conditions; empty days are not logged", () => {
  const day1: DayData = {
    foods: [food("קפה הפוך", 120), food("טוסט", 300)],
    drinks: [{ drink_type: "קולה", calories_kcal: 140, hydration_ml: 330, protein_g: 0, carbs_g: 35, fat_g: 0 } as unknown as DayData["drinks"][number]],
    activities: [],
    weights: [{ weight_kg: 80.2, measurement_conditions: "בוקר, לפני אוכל", measured_at: "" } as unknown as DayData["weights"][number]],
  };
  const day2: DayData = { foods: [food("קפה הפוך", 120)], drinks: [], activities: [], weights: [] };
  const ds = buildDataset({
    range: [
      { day: 20000, data: day1 },
      { day: 20001, data: null },
      { day: 20002, data: day2 },
    ],
    energy: { bmr: 1700, baselineKcal: 2300 },
    snackAllowanceKcal: 100,
    plan: { targetKcal: 1800, plannedWeeklyKg: -0.5, targetWeightKg: null, targetDate: null, baselineKcal: 2300 },
  });
  assert.deepEqual(
    ds.days.map((day) => [day.logged, day.entries, day.intakeKcal]),
    [
      [true, 2, 660], // 120 + 300 + 140 + 100 allowance
      [false, 0, 0],
      [true, 1, 220],
    ],
  );
  assert.deepEqual(ds.items[0], { name: "טוסט", totalKcal: 300, days: 1 });
  assert.deepEqual(ds.items.find((item) => item.name === "קפה הפוך"), { name: "קפה הפוך", totalKcal: 240, days: 2 });
  assert.deepEqual(ds.weighIns, [{ day: 20000, weightKg: 80.2, condition: "בוקר, לפני אוכל" }]);
});
