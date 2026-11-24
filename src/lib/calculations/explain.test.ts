import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineExpenditure, bmrMifflinStJeor, calorieTargetForPace } from "./energy.ts";
import { explainCalculation, targetForPace, type ExplainInput } from "./explain.ts";
import { macroTargets } from "./macros.ts";

// A woman of 48, 169 cm, 76 kg, light activity, 0.75 kg a week: the target hits the 1200 floor.
const bmr = bmrMifflinStJeor({ sex: "female", weightKg: 76, heightCm: 169, ageYears: 48 });
const baseline = baselineExpenditure(bmr, 1.35);
const target = calorieTargetForPace(baseline, -0.75, "female");
const input: ExplainInput = {
  sex: "female",
  ageYears: 48,
  heightCm: 169,
  weightKg: 76,
  weightSource: "weigh_in",
  activityFactor: 1.35,
  activityLabel: "קלה",
  bmr,
  formulaBaseline: baseline,
  adjustmentKcal: 0,
  baseline,
  weeklyGoalKg: -0.75,
  byDate: null,
  target,
  day: { isToday: true, foodKcal: 900, drinkKcal: 100, snackKcal: 80, workoutKcal: 250 },
  macros: macroTargets({
    targetKcal: target.targetKcal,
    weightKg: 76,
    targetWeightKg: 67,
    weeklyGoalKg: -0.75,
    activityFactor: 1.35,
    custom: { proteinG: null, fatG: null, carbsG: null },
  }),
};

const text = (steps: ReturnType<typeof explainCalculation>) =>
  steps.map((s) => [s.title, ...s.lines, s.result ?? ""].join("\n")).join("\n");

test("walks through resting rate, baseline, floor, day, macros and tips", () => {
  const steps = explainCalculation(input);
  const all = text(steps);
  assert.equal(steps[0].result, '1,415 קק"ל ביום');
  assert.ok(all.includes("10×76 + 6.25×169 − 5×48 − 161"));
  assert.equal(steps[1].result, '1,911 קק"ל ביום');
  assert.ok(all.includes("0.75 × 7,700 ÷ 7 = 825"));
  assert.ok(all.includes("1,911 − 825 = 1,086"));
  assert.ok(all.includes("היעד הועלה ל-1,200"));
  assert.ok(all.includes("גירעון של 711 ביום"));
  assert.ok(all.includes("1,200 + 250 = 1,450"));
  assert.ok(all.includes("900 + 100 + 80 = 1,080"));
  assert.ok(all.includes("נשאר לאכול 370"));
  assert.ok(all.includes("חלבון: 1.6 גרם לכל ק\"ג ממשקל היעד (67 ק\"ג)"));
  assert.ok(all.includes("בקצב של 0.5 ק\"ג בשבוע היעד יהיה כ-1,361"));
  // No calibration step without a confirmed adjustment.
  assert.ok(!all.includes("תיקון לפי הנתונים"));
});

test("a confirmed calibration adds its own step", () => {
  const steps = explainCalculation({ ...input, adjustmentKcal: 120, baseline: baseline + 120, day: null });
  const all = text(steps);
  assert.ok(all.includes("שורף יותר ממה שהנוסחה מעריכה"));
  assert.ok(all.includes("1,911 + 120"));
  assert.ok(!all.includes("נשאר לאכול"));
});

test("maintenance has no deficit line and no softer-pace tip", () => {
  const maintain = calorieTargetForPace(baseline, 0, "female");
  const all = text(explainCalculation({ ...input, weeklyGoalKg: 0, target: maintain }));
  assert.ok(all.includes("היעד שווה להוצאה הבסיסית"));
  assert.ok(!all.includes("פחות לחוץ"));
});

test("targetForPace keeps the floor", () => {
  assert.equal(targetForPace(1300, -0.75, "female"), 1200);
  assert.equal(Math.round(targetForPace(1911, -0.5, "female")), 1361);
});
