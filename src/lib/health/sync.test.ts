import { test } from "node:test";
import assert from "node:assert/strict";
import { activityTypeLabel, isSameWorkout, parseWorkout, planSync, workoutToActivity, type ExistingActivity } from "./sync.ts";
import { activityIcon } from "../day/entries.ts";
import { activeCaloriesForActivity } from "../calculations/energy.ts";

// Synthetic data only.

const at = (hour: number, minute = 0) => new Date(2026, 10, 13, hour, minute).toISOString();

const rawRide = {
  platformId: "hc-ride-1",
  workoutType: "cycling",
  startDate: at(12, 50),
  endDate: at(15, 27),
  duration: 157 * 60,
  totalEnergyBurned: 1520.44,
  totalDistance: 41800,
  sourceName: "Samsung Health",
};

test("workout types map to the app's Hebrew names, which have their own icons", () => {
  assert.equal(activityTypeLabel("cycling"), "רכיבה");
  assert.equal(activityTypeLabel("bikingStationary"), "רכיבה");
  assert.equal(activityTypeLabel("runningTreadmill"), "ריצה");
  assert.equal(activityTypeLabel("walking"), "הליכה");
  assert.equal(activityTypeLabel("swimmingPool"), "שחייה");
  assert.equal(activityTypeLabel("traditionalStrengthTraining"), "אימון כוח");
  assert.equal(activityTypeLabel("highIntensityIntervalTraining"), "CrossFit");
  assert.equal(activityTypeLabel("other"), "אחר");
  assert.equal(activityTypeLabel(""), "אחר");
  assert.equal(activityTypeLabel("rowing"), "rowing");
  assert.equal(activityIcon(activityTypeLabel("cycling")), "🚴");
});

test("a raw workout is checked and normalised", () => {
  const workout = parseWorkout(rawRide);
  assert.deepEqual(workout, {
    platformId: "hc-ride-1",
    workoutType: "cycling",
    startDate: at(12, 50),
    endDate: at(15, 27),
    durationSeconds: 9420,
    totalEnergyKcal: 1520.4,
    distanceM: 41800,
    sourceName: "Samsung Health",
  });
});

test("duration falls back to the start and end times; bad values become null", () => {
  const workout = parseWorkout({ ...rawRide, duration: undefined, totalEnergyBurned: -5, totalDistance: "far", sourceName: "" });
  assert.ok(workout);
  assert.equal(workout.durationSeconds, 9420);
  assert.equal(workout.totalEnergyKcal, null);
  assert.equal(workout.distanceM, null);
  assert.equal(workout.sourceName, null);
});

test("workouts without an id or a valid start are rejected", () => {
  assert.equal(parseWorkout({ ...rawRide, platformId: "" }), null);
  assert.equal(parseWorkout({ ...rawRide, startDate: "soon" }), null);
  assert.equal(parseWorkout(null), null);
  assert.equal(parseWorkout("workout"), null);
});

test("a synced workout is stored with total calories, so its resting share is removed in the balance", () => {
  const workout = parseWorkout(rawRide);
  assert.ok(workout);
  const row = workoutToActivity(workout);
  assert.equal(row.external_provider, "health_connect");
  assert.equal(row.external_activity_id, "hc-ride-1");
  assert.equal(row.activity_type, "רכיבה");
  assert.equal(row.calories_active_kcal, null);
  assert.equal(row.calories_total_kcal, 1520.4);
  assert.equal(row.calories_source, "external");
  assert.match(row.notes ?? "", /Samsung Health/);

  const counted = activeCaloriesForActivity(
    { caloriesActiveKcal: row.calories_active_kcal, caloriesTotalKcal: row.calories_total_kcal, durationSeconds: row.duration_seconds },
    1780,
  );
  assert.equal(counted.method, "total_minus_resting");
  // resting share: 1780 kcal a day * 9420 s / 86400 s = 194.07
  assert.ok(Math.abs(counted.kcal - (1520.4 - 194.07)) < 0.01);
});

test("same-workout detection: close starts or substantial overlap", () => {
  const manual = { started_at: at(13, 0), duration_seconds: 157 * 60 };
  assert.equal(isSameWorkout(manual, { started_at: at(12, 50), duration_seconds: 9420 }), true);
  assert.equal(isSameWorkout(manual, { started_at: at(14, 0), duration_seconds: 3600 }), true); // inside the ride
  assert.equal(isSameWorkout(manual, { started_at: at(16, 0), duration_seconds: 3600 }), false);
  assert.equal(isSameWorkout(manual, { started_at: at(7, 0), duration_seconds: 1800 }), false);
  assert.equal(isSameWorkout({ started_at: at(13, 0), duration_seconds: null }, { started_at: at(13, 15), duration_seconds: null }), true);
  assert.equal(isSameWorkout({ started_at: at(13, 0), duration_seconds: null }, { started_at: at(14, 0), duration_seconds: null }), false);
  assert.equal(isSameWorkout({ started_at: "x", duration_seconds: 60 }, manual), false);
});

const manualRide: ExistingActivity = {
  id: "manual-1",
  started_at: at(13, 0),
  duration_seconds: 157 * 60,
  external_provider: null,
  external_activity_id: null,
  excluded_from_balance: false,
};

test("first sync inserts the workout and stops counting the manual entry of the same ride", () => {
  const ride = parseWorkout(rawRide);
  const morningRun = parseWorkout({ ...rawRide, platformId: "hc-run-1", workoutType: "running", startDate: at(6, 30), endDate: at(7, 10), duration: 2400 });
  assert.ok(ride && morningRun);
  const plan = planSync([ride, morningRun], [manualRide]);
  assert.deepEqual(plan.toInsert.map((row) => row.external_activity_id), ["hc-ride-1", "hc-run-1"]);
  assert.deepEqual(plan.manualDuplicateIds, ["manual-1"]);
  assert.equal(plan.alreadySynced, 0);
});

test("a second sync inserts nothing and changes nothing", () => {
  const ride = parseWorkout(rawRide);
  assert.ok(ride);
  const stored: ExistingActivity[] = [
    { ...manualRide, excluded_from_balance: true },
    { id: "s1", started_at: at(12, 50), duration_seconds: 9420, external_provider: "health_connect", external_activity_id: "hc-ride-1", excluded_from_balance: false },
  ];
  const plan = planSync([ride, ride], stored);
  assert.deepEqual(plan.toInsert, []);
  assert.deepEqual(plan.manualDuplicateIds, []);
  assert.equal(plan.alreadySynced, 2);
});

test("the user's choice to count the manual entry instead is respected", () => {
  const ride = parseWorkout(rawRide);
  assert.ok(ride);
  // The user re-enabled the manual entry and excluded the synced one.
  const stored: ExistingActivity[] = [
    manualRide,
    { id: "s1", started_at: at(12, 50), duration_seconds: 9420, external_provider: "health_connect", external_activity_id: "hc-ride-1", excluded_from_balance: true },
  ];
  const plan = planSync([ride], stored);
  assert.deepEqual(plan.manualDuplicateIds, []);
});

test("unrelated manual activities are left alone, and repeated ids in one batch insert once", () => {
  const ride = parseWorkout(rawRide);
  assert.ok(ride);
  const gym: ExistingActivity = { ...manualRide, id: "manual-gym", started_at: at(19, 0), duration_seconds: 3600 };
  const plan = planSync([ride, ride], [gym]);
  assert.equal(plan.toInsert.length, 1);
  assert.deepEqual(plan.manualDuplicateIds, []);
});
