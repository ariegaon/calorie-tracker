import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeCaloriesForActivity,
  baselineExpenditure,
  bmrMifflinStJeor,
  calorieTargetForPace,
  dailyBalance,
  sumActiveCalories,
  theoreticalWeightChangeKg,
} from "./energy.ts";

// Synthetic data only. Expected values were worked out by hand from the formulas.

function near(actual: number, expected: number, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

test("BMR, Mifflin-St Jeor, male", () => {
  // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5
  assert.equal(bmrMifflinStJeor({ sex: "male", weightKg: 80, heightCm: 180, ageYears: 30 }), 1780);
});

test("BMR, Mifflin-St Jeor, female", () => {
  // 10*60 + 6.25*165 - 5*40 - 161 = 600 + 1031.25 - 200 - 161
  assert.equal(bmrMifflinStJeor({ sex: "female", weightKg: 60, heightCm: 165, ageYears: 40 }), 1270.25);
});

test("BMR differs by exactly 166 kcal between the sexes for the same body", () => {
  const body = { weightKg: 70, heightCm: 170, ageYears: 35 };
  assert.equal(bmrMifflinStJeor({ sex: "male", ...body }) - bmrMifflinStJeor({ sex: "female", ...body }), 166);
});

test("BMR rejects non-positive and non-numeric input", () => {
  assert.throws(() => bmrMifflinStJeor({ sex: "male", weightKg: 0, heightCm: 180, ageYears: 30 }), RangeError);
  assert.throws(() => bmrMifflinStJeor({ sex: "male", weightKg: 80, heightCm: Number.NaN, ageYears: 30 }), RangeError);
});

test("baseline expenditure is BMR times the everyday factor", () => {
  near(baselineExpenditure(1780, 1.2), 2136);
  near(baselineExpenditure(1780, 1.55), 2759);
  assert.throws(() => baselineExpenditure(1780, 0.9), RangeError);
  assert.throws(() => baselineExpenditure(1780, 3), RangeError);
});

test("reported active calories are used as they are", () => {
  const result = activeCaloriesForActivity(
    { caloriesActiveKcal: 450, caloriesTotalKcal: 520, durationSeconds: 3600 },
    1780,
  );
  assert.deepEqual(result, { kcal: 450, method: "active_reported" });
});

test("total-only calories have the resting share of the workout removed", () => {
  // resting share for one hour: 1780 / 24 = 74.1667, so 600 - 74.1667
  const result = activeCaloriesForActivity(
    { caloriesActiveKcal: null, caloriesTotalKcal: 600, durationSeconds: 3600 },
    1780,
  );
  assert.equal(result.method, "total_minus_resting");
  near(result.kcal, 525.83);
});

test("total-only calories never go negative", () => {
  const result = activeCaloriesForActivity(
    { caloriesActiveKcal: null, caloriesTotalKcal: 20, durationSeconds: 3600 },
    1780,
  );
  assert.equal(result.kcal, 0);
});

test("total-only calories without a duration are not added", () => {
  const result = activeCaloriesForActivity(
    { caloriesActiveKcal: null, caloriesTotalKcal: 600, durationSeconds: null },
    1780,
  );
  assert.deepEqual(result, { kcal: 0, method: "total_not_separable" });
});

test("a workout that arrived twice is counted once", () => {
  const synced = { caloriesActiveKcal: 400, caloriesTotalKcal: null, durationSeconds: 2400 };
  const typedDuplicate = { ...synced, excludedFromBalance: true };
  const summary = sumActiveCalories([synced, typedDuplicate], 1780);
  assert.deepEqual(summary, { activeKcal: 400, countedActivities: 1, notSeparable: 0, excluded: 1 });
});

test("a day of mixed workouts sums only what can be counted", () => {
  const summary = sumActiveCalories(
    [
      { caloriesActiveKcal: 300, caloriesTotalKcal: null, durationSeconds: 1800 },
      { caloriesActiveKcal: null, caloriesTotalKcal: 600, durationSeconds: 3600 },
      { caloriesActiveKcal: null, caloriesTotalKcal: 250, durationSeconds: null },
      { caloriesActiveKcal: null, caloriesTotalKcal: null, durationSeconds: 1200 },
    ],
    1780,
  );
  near(summary.activeKcal, 825.83);
  assert.equal(summary.countedActivities, 2);
  assert.equal(summary.notSeparable, 1);
  assert.equal(summary.excluded, 0);
});

test("an empty day has no active calories", () => {
  assert.deepEqual(sumActiveCalories([], 1780), { activeKcal: 0, countedActivities: 0, notSeparable: 0, excluded: 0 });
});

test("daily balance: deficit", () => {
  const result = dailyBalance({ foodKcal: 1800, drinkKcal: 100, baselineKcal: 2136, activeKcal: 400 });
  assert.deepEqual(result, { consumedKcal: 1900, burnedKcal: 2536, balanceKcal: -636, status: "deficit" });
});

test("daily balance: surplus", () => {
  const result = dailyBalance({ foodKcal: 2600, drinkKcal: 200, baselineKcal: 2136, activeKcal: 0 });
  assert.equal(result.balanceKcal, 664);
  assert.equal(result.status, "surplus");
});

test("daily balance: small differences count as balanced", () => {
  assert.equal(dailyBalance({ foodKcal: 2100, drinkKcal: 0, baselineKcal: 2136, activeKcal: 0 }).status, "balanced");
  assert.equal(dailyBalance({ foodKcal: 2086, drinkKcal: 0, baselineKcal: 2136, activeKcal: 0 }).status, "deficit");
});

test("theoretical weight change uses 7700 kcal per kg", () => {
  assert.equal(theoreticalWeightChangeKg(-7700), -1);
  assert.equal(theoreticalWeightChangeKg(3850), 0.5);
  assert.equal(theoreticalWeightChangeKg(0), 0);
});

test("calorie target follows the weekly pace", () => {
  // -0.5 kg/week = -3850 kcal/week = -550 kcal/day
  const result = calorieTargetForPace(2136, -0.5, "male");
  near(result.dailyAdjustmentKcal, -550);
  near(result.targetKcal, 1586);
  assert.equal(result.limitedByMinimum, false);
});

test("calorie target for maintenance equals the baseline", () => {
  const result = calorieTargetForPace(2136, 0, "female");
  assert.equal(result.targetKcal, 2136);
  assert.equal(result.dailyAdjustmentKcal, 0);
});

test("calorie target is not suggested below the minimum", () => {
  // 1524.3 - 825 = 699.3, below the 1200 minimum
  const result = calorieTargetForPace(1524.3, -0.75, "female");
  assert.equal(result.targetKcal, 1200);
  assert.equal(result.limitedByMinimum, true);
});
