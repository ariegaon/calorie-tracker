import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityTypeLabel,
  isSameWorkout,
  parseWorkout,
  planNewActivities,
  planSync,
  sourceRank,
  stravaToActivity,
  workoutToActivity,
  type ExistingActivity,
} from "./sync.ts";
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

test("a workout without an id gets a stable one from its times and type", () => {
  const first = parseWorkout({ ...rawRide, platformId: "" });
  const again = parseWorkout({ ...rawRide, platformId: undefined });
  assert.ok(first && again);
  assert.match(first.platformId, /^generated:/);
  assert.equal(first.platformId, again.platformId);
  const other = parseWorkout({ ...rawRide, platformId: "", startDate: at(6, 0), endDate: at(7, 0) });
  assert.notEqual(other?.platformId, first.platformId);
});

test("alternative field names from the plugin are understood", () => {
  const workout = parseWorkout({ id: "abc", type: "running", startTime: at(6, 0), endTime: at(6, 30), calories: 300, distance: 5000 });
  assert.ok(workout);
  assert.equal(workout.platformId, "abc");
  assert.equal(workout.workoutType, "running");
  assert.equal(workout.durationSeconds, 1800);
  assert.equal(workout.totalEnergyKcal, 300);
  assert.equal(workout.distanceM, 5000);
});

test("workouts without a valid start are rejected", () => {
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
  assert.deepEqual(plan.toInsert.map((row) => row.external_activity_id), ["hc-run-1", "hc-ride-1"]); // oldest first
  assert.deepEqual(plan.toInsert.map((row) => row.excluded_from_balance), [false, false]);
  assert.deepEqual(plan.excludeIds, ["manual-1"]);
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
  assert.deepEqual(plan.excludeIds, []);
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
  assert.deepEqual(plan.excludeIds, []);
});

test("unrelated manual activities are left alone, and repeated ids in one batch insert once", () => {
  const ride = parseWorkout(rawRide);
  assert.ok(ride);
  const gym: ExistingActivity = { ...manualRide, id: "manual-gym", started_at: at(19, 0), duration_seconds: 3600 };
  const plan = planSync([ride, ride], [gym]);
  assert.equal(plan.toInsert.length, 1);
  assert.deepEqual(plan.excludeIds, []);
});

// ------------------------------------------------------------------ Strava and several sources

const stravaRide = {
  id: 9876543210,
  name: "רכיבת בוקר",
  sport_type: "Ride",
  start_date: at(12, 50),
  elapsed_time: 9420,
  moving_time: 9000,
  distance: 41800.4,
  calories: 1490.2,
  device_name: "Samsung Health",
};

test("a Strava activity becomes an activity row with total calories", () => {
  const row = stravaToActivity(stravaRide);
  assert.deepEqual(row, {
    external_provider: "strava",
    external_activity_id: "9876543210",
    source_app: "Samsung Health",
    activity_type: "רכיבה",
    started_at: at(12, 50),
    duration_seconds: 9420,
    distance_m: 41800.4,
    calories_active_kcal: null,
    calories_total_kcal: 1490.2,
    calories_source: "external",
    notes: "Strava: רכיבת בוקר",
  });
});

test("Strava sport types and missing fields are handled", () => {
  assert.equal(stravaToActivity({ ...stravaRide, sport_type: "TrailRun" })?.activity_type, "ריצה");
  assert.equal(stravaToActivity({ ...stravaRide, sport_type: "WeightTraining" })?.activity_type, "אימון כוח");
  assert.equal(stravaToActivity({ ...stravaRide, sport_type: "MountainBikeRide" })?.activity_type, "רכיבה");
  const powerRide = stravaToActivity({ ...stravaRide, calories: undefined, kilojoules: 1210 });
  assert.equal(powerRide?.calories_total_kcal, 1210);
  const bare = stravaToActivity({ id: "5", start_date: at(8, 0), type: "Walk" });
  assert.ok(bare);
  assert.equal(bare.activity_type, "הליכה");
  assert.equal(bare.calories_total_kcal, null);
  assert.equal(bare.duration_seconds, null);
  assert.equal(bare.source_app, "Strava");
  assert.equal(stravaToActivity({ start_date: at(8, 0) }), null);
  assert.equal(stravaToActivity({ id: 1, start_date: "x" }), null);
  assert.equal(stravaToActivity(null), null);
});

test("source ranks: watch app over Strava over Strava's own Health Connect copy over manual", () => {
  assert.equal(sourceRank({ external_provider: null }), 0);
  assert.equal(sourceRank({ external_provider: "health_connect", source_app: "com.strava" }), 1);
  assert.equal(sourceRank({ external_provider: "strava", source_app: "Samsung Health" }), 2);
  assert.equal(sourceRank({ external_provider: "health_connect", source_app: "Samsung Health" }), 3);
  assert.equal(sourceRank({ external_provider: "health_connect", source_app: null }), 3);
});

function stored(id: string, provider: string | null, sourceApp: string | null, excluded = false): ExistingActivity {
  return {
    id,
    started_at: at(12, 50),
    duration_seconds: 9420,
    external_provider: provider,
    external_activity_id: provider ? `ext-${id}` : null,
    source_app: sourceApp,
    excluded_from_balance: excluded,
  };
}

test("a watch workout already synced from Health Connect: its Strava copy arrives uncounted", () => {
  const candidate = stravaToActivity(stravaRide);
  assert.ok(candidate);
  const plan = planNewActivities([candidate], [stored("hc", "health_connect", "Samsung Health")]);
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.toInsert[0].excluded_from_balance, true);
  assert.deepEqual(plan.excludeIds, []);
});

test("the Strava copy came first: the Health Connect original takes over when it arrives", () => {
  const ride = parseWorkout(rawRide);
  assert.ok(ride);
  const plan = planSync([ride], [stored("st", "strava", "Samsung Health"), stored("man", null, null)]);
  assert.equal(plan.toInsert[0].excluded_from_balance, false);
  assert.deepEqual(plan.excludeIds.sort(), ["man", "st"]);
});

test("a workout started in Strava counts from Strava, not from the copy Strava wrote to Health Connect", () => {
  const stravaCopy = parseWorkout({ ...rawRide, platformId: "hc-from-strava", sourceName: "com.strava" });
  const candidate = stravaToActivity({ ...stravaRide, device_name: "Strava Android App" });
  assert.ok(stravaCopy && candidate);

  // Strava first, then its Health Connect copy.
  const later = planSync([stravaCopy], [stored("st", "strava", "Strava Android App")]);
  assert.equal(later.toInsert[0].excluded_from_balance, true);
  assert.deepEqual(later.excludeIds, []);

  // Health Connect copy first, then Strava.
  const earlier = planNewActivities([candidate], [stored("hc", "health_connect", "com.strava")]);
  assert.equal(earlier.toInsert[0].excluded_from_balance, false);
  assert.deepEqual(earlier.excludeIds, ["hc"]);
});

test("both copies arriving in one batch still count once", () => {
  const ride = workoutToActivity(parseWorkout(rawRide)!);
  const copy = stravaToActivity(stravaRide)!;
  const plan = planNewActivities([copy, ride], []);
  assert.equal(plan.toInsert.length, 2);
  const countedRows = plan.toInsert.filter((row) => !row.excluded_from_balance);
  assert.equal(countedRows.length, 1);
  assert.equal(countedRows[0].external_provider, "health_connect");
});

test("a Strava-only workout counts, and replaces a manual entry of it", () => {
  const candidate = stravaToActivity({ ...stravaRide, device_name: "Garmin Edge 840" });
  assert.ok(candidate);
  const plan = planNewActivities([candidate], [stored("man", null, null)]);
  assert.equal(plan.toInsert[0].excluded_from_balance, false);
  assert.deepEqual(plan.excludeIds, ["man"]);
});

test("a later sync never overrides the user's manual choice between copies", () => {
  const candidate = stravaToActivity(stravaRide);
  assert.ok(candidate);
  // The user chose to count the Strava copy and excluded the Health Connect one. Nothing new arrives.
  const existing = [
    { ...stored("st", "strava", "Samsung Health"), external_activity_id: "9876543210" },
    stored("hc", "health_connect", "Samsung Health", true),
  ];
  const plan = planNewActivities([candidate], existing);
  assert.deepEqual(plan.toInsert, []);
  assert.deepEqual(plan.excludeIds, []);
  assert.equal(plan.alreadySynced, 1);
});
