import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityTypeLabel,
  isPlausibleEnergy,
  needsEnergy,
  repairFor,
  sessionEnergy,
  sourceLabel,
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
  sourceName: "com.sec.android.app.shealth",
  sourceId: "com.sec.android.app.shealth",
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
    sourceName: "com.sec.android.app.shealth",
    sourceId: "com.sec.android.app.shealth",
  });
});

test("duration falls back to the start and end times; bad values become null", () => {
  const workout = parseWorkout({ ...rawRide, duration: undefined, totalEnergyBurned: -5, totalDistance: "far", sourceName: "", sourceId: "" });
  assert.ok(workout);
  assert.equal(workout.durationSeconds, 9420);
  assert.equal(workout.totalEnergyKcal, null);
  assert.equal(workout.distanceM, null);
  assert.equal(workout.sourceName, null);
  assert.equal(workout.sourceId, null);
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
  // Strava's records carry the phone as the device label, so only the package name identifies them.
  const stravaCopy = parseWorkout({ ...rawRide, platformId: "hc-from-strava", sourceName: "samsung SM-S918B", sourceId: "com.strava" });
  assert.equal(workoutToActivity(stravaCopy!).source_app, "com.strava");
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

// ------------------------------------------------------------------ energy of a session (Galaxy Watch CrossFit)

// A CrossFit session as Samsung Health writes it: generic type, no active-calorie records of its own.
const rawCrossfit = {
  platformId: "hc-crossfit-1",
  workoutType: "other",
  startDate: at(17, 0),
  endDate: at(17, 53),
  duration: 53 * 60,
  totalEnergyBurned: 2.7, // stray active calories from another app during the hour
  totalDistance: 27.7,
  sourceName: "com.sec.android.app.shealth",
  sourceId: "com.sec.android.app.shealth",
};

const totalSamples = [
  { value: 366, unit: "kilocalorie", startDate: at(17, 0), endDate: at(17, 53), sourceId: "com.sec.android.app.shealth" },
  { value: 2100, unit: "kilocalorie", startDate: at(0, 0), endDate: at(23, 59), sourceId: "com.sec.android.app.shealth" }, // whole day
  { value: 40, unit: "kilocalorie", startDate: at(16, 30), endDate: at(17, 10), sourceId: "com.sec.android.app.shealth" }, // straddles the start
];

test("believable energy is at least one kcal a minute", () => {
  assert.equal(isPlausibleEnergy(2.7, 53 * 60), false);
  assert.equal(isPlausibleEnergy(366, 53 * 60), true);
  assert.equal(isPlausibleEnergy(null, 600), false);
  assert.equal(isPlausibleEnergy(0, 600), false);
  assert.equal(isPlausibleEnergy(120, null), true);
});

test("session energy uses only calorie records inside the workout", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  assert.equal(sessionEnergy(totalSamples, workout), 366);
  assert.equal(sessionEnergy([totalSamples[1], totalSamples[2]], workout), null);
  assert.equal(sessionEnergy([], workout), null);
  assert.equal(sessionEnergy([null, "x", { value: "366" }, { value: 50, startDate: "bad", endDate: at(17, 30) }], workout), null);
});

test("session energy is taken from the app that recorded the workout, never summed across apps", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  const twoApps = [
    { value: 200, startDate: at(17, 0), endDate: at(17, 25), sourceId: "com.sec.android.app.shealth" },
    { value: 166, startDate: at(17, 25), endDate: at(17, 53), sourceId: "com.sec.android.app.shealth" },
    { value: 380, startDate: at(17, 0), endDate: at(17, 53), sourceId: "com.strava" },
  ];
  assert.equal(sessionEnergy(twoApps, workout), 366);
  // Without records from the recording app, the largest single app is used.
  const others = [
    { value: 380, startDate: at(17, 0), endDate: at(17, 53), sourceId: "com.strava" },
    { value: 12, startDate: at(17, 10), endDate: at(17, 20), sourceId: "com.other" },
  ];
  assert.equal(sessionEnergy(others, workout), 380);
});

test("a Galaxy Watch CrossFit session: 366 total kcal, named by the user's choice, no stray distance", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  assert.equal(workout.distanceM, null);
  const row = workoutToActivity(workout, { genericLabel: "CrossFit", energy: { totalKcal: 366, activeKcal: null } });
  assert.equal(row.activity_type, "CrossFit");
  assert.equal(row.calories_total_kcal, 366);
  assert.equal(row.calories_active_kcal, null);
  assert.equal(row.distance_m, null);
  assert.equal(row.source_app, "com.sec.android.app.shealth");
  assert.equal(row.notes, "סונכרן מ-Samsung Health");

  // In the balance: 366 minus the resting share of 53 minutes (1780 * 3180 / 86400 = 65.5).
  const counted = activeCaloriesForActivity(
    { caloriesActiveKcal: null, caloriesTotalKcal: row.calories_total_kcal, durationSeconds: row.duration_seconds },
    1780,
  );
  assert.ok(Math.abs(counted.kcal - (366 - 65.51)) < 0.05);
});

test("without calorie records an unbelievable figure is dropped, not stored", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  const row = workoutToActivity(workout);
  assert.equal(row.calories_total_kcal, null);
  assert.equal(row.calories_active_kcal, null);
  assert.equal(row.activity_type, "אחר");
});

test("active calorie records are used as active when there are no total records", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  const row = workoutToActivity(workout, { energy: { totalKcal: null, activeKcal: 300 } });
  assert.equal(row.calories_active_kcal, 300);
  assert.equal(row.calories_total_kcal, null);
});

test("the user's generic label does not rename workouts that have a specific type", () => {
  const ride = parseWorkout(rawRide);
  assert.ok(ride);
  assert.equal(workoutToActivity(ride, { genericLabel: "CrossFit" }).activity_type, "רכיבה");
});

test("source labels are readable", () => {
  assert.equal(sourceLabel({ sourceId: "com.sec.android.app.shealth", sourceName: "samsung SM-S918B" }), "Samsung Health");
  assert.equal(sourceLabel({ sourceId: "com.strava", sourceName: null }), "Strava");
  assert.equal(sourceLabel({ sourceId: "com.example.app", sourceName: null }), "com.example.app");
  assert.equal(sourceLabel({ sourceId: null, sourceName: null }), "Health Connect");
});

// ------------------------------------------------------------------ repairing rows from earlier syncs

const storedCrossfit = {
  id: "row-1",
  external_activity_id: "hc-crossfit-1",
  activity_type: "אחר",
  duration_seconds: 3125,
  distance_m: 27.7,
  calories_active_kcal: null,
  calories_total_kcal: 2.7,
  source_app: "com.sec.android.app.shealth",
};

test("a row synced with a stray energy figure is repaired", () => {
  assert.equal(needsEnergy(storedCrossfit), true);
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  const fresh = workoutToActivity(workout, { genericLabel: "CrossFit", energy: { totalKcal: 366, activeKcal: null } });
  assert.deepEqual(repairFor(storedCrossfit, fresh), { calories_total_kcal: 366, activity_type: "CrossFit", distance_m: null });
});

test("a stray figure is cleared even when no better one was found", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  assert.deepEqual(repairFor(storedCrossfit, workoutToActivity(workout)), { calories_total_kcal: null, distance_m: null });
});

test("rows with good values, and values the user typed, are left alone", () => {
  const workout = parseWorkout(rawCrossfit);
  assert.ok(workout);
  const fresh = workoutToActivity(workout, { genericLabel: "CrossFit", energy: { totalKcal: 366, activeKcal: null } });
  const good = { ...storedCrossfit, activity_type: "CrossFit", calories_total_kcal: 366, distance_m: null };
  assert.equal(repairFor(good, fresh), null);
  const userEdited = { ...storedCrossfit, activity_type: "אימון כוח", calories_active_kcal: 310, distance_m: null };
  assert.equal(needsEnergy(userEdited), false);
  assert.equal(repairFor(userEdited, fresh), null);
});

test("an older row learns which app wrote it", () => {
  const stravaCopy = parseWorkout({ ...rawRide, platformId: "x", sourceName: "samsung SM-S918B", sourceId: "com.strava" });
  assert.ok(stravaCopy);
  const stored = { ...storedCrossfit, activity_type: "רכיבה", calories_total_kcal: 1337.3, duration_seconds: 9420, distance_m: 41737, source_app: "samsung SM-S918B" };
  assert.deepEqual(repairFor(stored, workoutToActivity(stravaCopy)), { source_app: "com.strava" });
});

// ------------------------------------------------------------------ Apple Health

test("an Apple Health workout is its own provider, with the watch's active energy counted as it is", () => {
  const workout = parseWorkout({ ...rawRide, platformId: "hk-1", sourceName: "Apple Watch", sourceId: "com.apple.health" });
  assert.ok(workout);
  // HealthKit reports a workout's active energy, so it is passed as active and nothing is subtracted.
  const row = workoutToActivity(workout, { provider: "apple_health", energy: { totalKcal: null, activeKcal: workout.totalEnergyKcal } });
  assert.equal(row.external_provider, "apple_health");
  assert.equal(row.calories_active_kcal, 1520.4);
  assert.equal(row.calories_total_kcal, null);
  assert.equal(sourceRank(row), 3);
  assert.equal(sourceRank({ external_provider: "apple_health", source_app: "com.strava.stravaride" }), 1);
});

test("the same id from two providers is not mistaken for an already synced workout", () => {
  const workout = parseWorkout({ ...rawRide, platformId: "shared-id" });
  assert.ok(workout);
  const existing: ExistingActivity[] = [
    { id: "a", started_at: at(8, 0), duration_seconds: 600, external_provider: "health_connect", external_activity_id: "shared-id", excluded_from_balance: false },
  ];
  const plan = planNewActivities([workoutToActivity(workout, { provider: "apple_health" })], existing);
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.alreadySynced, 0);
});
