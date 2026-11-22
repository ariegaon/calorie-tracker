import { test } from "node:test";
import assert from "node:assert/strict";
import type { InsightDataset, InsightDay, InsightWeighIn } from "./dataset.ts";
import {
  delayedCompensation,
  fitWithConditionOffsets,
  goalReality,
  loggingBlindSpots,
  outlierDays,
  runAnalyses,
  smallSwap,
  weighInConditions,
} from "./analyses.ts";

// Synthetic data only. Day numbers are arbitrary; 20000 is in 2024.
const START = 20000;
const plan = { targetKcal: 1800, plannedWeeklyKg: -0.5, targetWeightKg: 74, targetDate: null, baselineKcal: 2350 };

function dataset(days: Partial<InsightDay>[], weighIns: InsightWeighIn[] = [], items: InsightDataset["items"] = []): InsightDataset {
  const full = days.map((day, i) => ({
    day: START + i,
    weekday: (START + i + 4) % 7,
    logged: true,
    entries: 3,
    intakeKcal: 1800,
    workoutKcal: 0,
    ...day,
  }));
  return { firstDay: START, lastDay: START + days.length - 1, days: full, weighIns, items, plan };
}

test("compensation: extra eating on the two days after big workouts is found", () => {
  // Every 6th day a 600 kcal workout; the next two days +250 each.
  const days: Partial<InsightDay>[] = [];
  for (let i = 0; i < 42; i += 1) {
    const phase = i % 6;
    days.push(phase === 0 ? { workoutKcal: 600 } : phase === 1 || phase === 2 ? { intakeKcal: 2050 } : {});
  }
  const finding = delayedCompensation(dataset(days));
  assert.ok(finding);
  assert.equal(finding.facts.extra_kcal_over_next_two_days, 500);
  assert.equal(finding.facts.avg_workout_active_kcal, 600);
  assert.ok(finding.text.includes("ביומיים שאחריו"));
});

test("compensation: nothing when the days after workouts are ordinary", () => {
  const days: Partial<InsightDay>[] = [];
  for (let i = 0; i < 42; i += 1) days.push(i % 6 === 0 ? { workoutKcal: 600 } : {});
  assert.equal(delayedCompensation(dataset(days)), null);
});

test("condition offsets are separated from the trend", () => {
  // Real trend -0.05 kg/day; evening-after-workout weigh-ins read 0.8 kg lower.
  const points = [];
  for (let i = 0; i < 28; i += 2) points.push({ day: START + i, weightKg: 80 - 0.05 * i, condition: "בוקר, לפני אוכל" });
  for (let i = 1; i < 28; i += 3) points.push({ day: START + i, weightKg: 80 - 0.05 * i - 0.8, condition: "ערב, אחרי אימון" });
  const fit = fitWithConditionOffsets(points, "בוקר, לפני אוכל");
  assert.ok(fit);
  assert.ok(Math.abs(fit.slopeKgPerDay - -0.05) < 1e-9);
  assert.ok(Math.abs((fit.offsets.get("ערב, אחרי אימון") ?? 0) - -0.8) < 1e-9);
});

test("weigh-in conditions: a mix that hides the real trend is reported", () => {
  // Real loss of 0.35 kg/week. Early weigh-ins are evening-after-workout (0.9 kg lower), later ones morning:
  // mixed together the trend looks almost flat.
  const weighIns: InsightWeighIn[] = [];
  for (let i = 0; i < 14; i += 2) weighIns.push({ day: START + i, weightKg: 80 - 0.05 * i - 0.9, condition: "ערב, אחרי אימון" });
  for (let i = 14; i < 28; i += 2) weighIns.push({ day: START + i, weightKg: 80 - 0.05 * i, condition: "בוקר, לפני אוכל" });
  weighIns.push({ day: START + 27, weightKg: 80 - 0.05 * 27 - 0.9, condition: "ערב, אחרי אימון" });
  const finding = weighInConditions(dataset(new Array(28).fill({}), weighIns));
  assert.ok(finding);
  assert.equal(finding.facts.real_trend_kg_per_week, -0.35);
  assert.equal(Math.abs(Number(finding.facts.offset_kg)), 0.9);
  assert.equal(finding.facts.mixing_distorts_trend, "yes");
});

test("small swap: a recurring item with a large share is found, with the half-year effect", () => {
  const items = [
    { name: "קפה הפוך 3%", totalKcal: 28 * 360, days: 28 },
    { name: "לחם", totalKcal: 28 * 200, days: 20 },
  ];
  const finding = smallSwap(dataset(new Array(28).fill({}), [], items));
  assert.ok(finding);
  assert.equal(finding.facts.item, "קפה הפוך 3%");
  assert.equal(finding.facts.item_share_of_calories_percent, 20);
  // 360 * 0.25 * 182 / 7700 = 2.1
  assert.equal(finding.facts.kg_in_half_year_if_reduced_by_quarter, 2.1);
});

test("small swap: nothing when no item recurs", () => {
  const items = [{ name: "פיצה", totalKcal: 5000, days: 3 }];
  assert.equal(smallSwap(dataset(new Array(28).fill({}), [], items)), null);
});

function steadyWeighIns(perWeek: number, count = 12): InsightWeighIn[] {
  return Array.from({ length: count }, (_, i) => ({ day: START + 4 + i * 2, weightKg: 80 + (perWeek / 7) * (i * 2), condition: null }));
}

test("goal reality: a pace well behind the plan is reported with the gap in kcal and the realistic date", () => {
  const ds = dataset(new Array(28).fill({}), steadyWeighIns(-0.2));
  const finding = goalReality(ds);
  assert.ok(finding);
  assert.equal(finding.facts.actual_trend_kg_per_week, -0.2);
  // (−0.2 − (−0.5)) * 7700 / 7 = 330
  assert.equal(finding.facts.gap_kcal_per_day, 330);
  assert.ok(typeof finding.facts.eta_at_actual_pace === "string");
});

test("goal reality: nothing when the pace matches the plan", () => {
  assert.equal(goalReality(dataset(new Array(28).fill({}), steadyWeighIns(-0.45))), null);
});

test("outlier days: a few big days that make most of the excess", () => {
  const days: Partial<InsightDay>[] = new Array(28).fill(null).map((_, i) =>
    i % 7 === 5 ? { intakeKcal: 2900 } : { intakeKcal: 1700 },
  );
  const finding = outlierDays(dataset(days));
  assert.ok(finding);
  assert.equal(finding.facts.spike_days, 4);
  assert.equal(finding.facts.spikes_share_of_all_excess_percent, 100);
  assert.equal(finding.facts.other_days_vs_target_kcal, -100);
});

test("outlier days: steady overeating is not reported as outliers", () => {
  assert.equal(outlierDays(dataset(new Array(28).fill({ intakeKcal: 2400 }))), null);
});

test("blind spots: the scale shows a smaller loss than the log implies", () => {
  // Log says 1800 in, 2350 out: -550 a day (-0.5 kg/week). The scale shows -0.1 kg/week (-110 a day).
  const ds = dataset(new Array(28).fill(null).map((_, i) => (i % 3 === 0 ? { entries: 1 } : {})), steadyWeighIns(-0.1));
  const finding = loggingBlindSpots(ds);
  assert.ok(finding);
  assert.equal(finding.facts.balance_from_log_kcal_per_day, -550);
  assert.equal(finding.facts.unlogged_kcal_per_day, 440);
  assert.equal(finding.facts.days_with_one_entry_percent, 36);
});

test("too little data gives no findings at all", () => {
  assert.deepEqual(runAnalyses(dataset(new Array(5).fill({}))), []);
});
