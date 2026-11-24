import { test } from "node:test";
import assert from "node:assert/strict";
import { macroStatus, macroTargets, proteinGramsPerKg, proteinReferenceWeight, type MacroInput } from "./macros.ts";

const base: MacroInput = {
  targetKcal: 2000,
  weightKg: 90,
  targetWeightKg: 80,
  weeklyGoalKg: -0.5,
  activityFactor: 1.2,
  custom: { proteinG: null, fatG: null, carbsG: null },
};

test("protein g/kg: 1.6 when changing weight or active, 1.2 at maintenance and sedentary", () => {
  assert.equal(proteinGramsPerKg(-0.5, 1.2), 1.6);
  assert.equal(proteinGramsPerKg(0.25, 1.2), 1.6);
  assert.equal(proteinGramsPerKg(0, 1.55), 1.6);
  assert.equal(proteinGramsPerKg(0, 1.2), 1.2);
});

test("protein uses the target weight only when it is lower", () => {
  assert.equal(proteinReferenceWeight(90, 80), 80);
  assert.equal(proteinReferenceWeight(70, 75), 70);
  assert.equal(proteinReferenceWeight(70, null), 70);
});

test("recommended targets in a deficit", () => {
  const t = macroTargets(base);
  assert.deepEqual(t.protein, { kind: "goal", grams: 130, source: "auto" }); // 1.6 × 80 = 128 → 130
  assert.deepEqual(t.fat, { kind: "range", min: 44, max: 78, source: "auto" }); // 20–35% of 2000 / 9
  // (2000 − 130×4 − fat×9) / 4
  assert.deepEqual(t.carbs, { kind: "range", min: 195, max: 271, source: "auto" });
  assert.equal(t.proteinBasis.fromTargetWeight, true);
  assert.equal(t.carbsBelowUsualRange, false);
});

test("protein is capped at 35% of the calories", () => {
  const t = macroTargets({ ...base, targetKcal: 1200, weightKg: 120, targetWeightKg: 100 });
  assert.equal(t.proteinBasis.cappedByCalories, true);
  assert.equal(t.protein.grams, 105); // 1200 × 0.35 / 4 = 105
});

test("a low target flags carbohydrates below the usual share", () => {
  const t = macroTargets({ ...base, targetKcal: 1300 });
  assert.equal(t.carbsBelowUsualRange, true);
});

test("the user's own values replace the recommendation, and carbs follow a set fat", () => {
  const t = macroTargets({ ...base, custom: { proteinG: 150, fatG: 60, carbsG: null } });
  assert.deepEqual(t.protein, { kind: "goal", grams: 150, source: "custom" });
  assert.deepEqual(t.fat, { kind: "goal", grams: 60, source: "custom" });
  assert.deepEqual(t.carbs, { kind: "goal", grams: 215, source: "auto" }); // (2000 − 600 − 540) / 4
  assert.equal(t.proteinBasis.recommendedG, 130);
  const own = macroTargets({ ...base, custom: { proteinG: null, fatG: null, carbsG: 120 } });
  assert.deepEqual(own.carbs, { kind: "goal", grams: 120, source: "custom" });
  assert.deepEqual(own.recommended.carbs, { min: 195, max: 271 });
});

test("status against a goal and a range", () => {
  assert.equal(macroStatus({ kind: "goal", grams: 100, source: "auto" }, 99), "below");
  assert.equal(macroStatus({ kind: "goal", grams: 100, source: "auto" }, 100), "within");
  const range = { kind: "range", min: 40, max: 70, source: "auto" } as const;
  assert.equal(macroStatus(range, 30), "below");
  assert.equal(macroStatus(range, 55), "within");
  assert.equal(macroStatus(range, 80), "above");
});
