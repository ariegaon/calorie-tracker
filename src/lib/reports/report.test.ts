import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsights, buildReport, exportRows, toCsv } from "./report.ts";
import {
  drinkFavoritePayload,
  drinkFromFavorite,
  favoriteCalories,
  favoriteProtein,
  mealFavoritePayload,
  mealFromFavorite,
  parseFavorite,
} from "../favorites.ts";
import type { DayData } from "../day/summary.ts";
import type { ActivityRow, DrinkRow, FoodRow } from "../day/entries.ts";

// Synthetic data only.

function near(actual: number | null, expected: number, tolerance = 0.01) {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function food(id: string, at: Date, kcal: number, protein: number, source = "manual", corrected = false): FoodRow {
  return {
    id,
    consumed_at: at.toISOString(),
    name: `ארוחה ${id}`,
    meal_type: "lunch",
    source: "manual",
    notes: null,
    items: [
      {
        id: `${id}-i`,
        food_entry_id: id,
        food_name: `מנה ${id}`,
        quantity: 200,
        quantity_unit: "g",
        calories_kcal: kcal,
        protein_g: protein,
        carbs_g: 10,
        fat_g: 5,
        source,
        user_corrected: corrected,
      },
    ],
  };
}

function drink(id: string, at: Date, volume: number, kcal = 0, protein = 0): DrinkRow {
  return {
    id,
    consumed_at: at.toISOString(),
    drink_type: "מים",
    volume_ml: volume,
    calories_kcal: kcal,
    caffeine_mg: null,
    hydration_ml: volume,
    protein_g: protein,
    carbs_g: 0,
    fat_g: 0,
    notes: null,
  };
}

function run(id: string, at: Date, minutes: number, activeKcal: number | null, type = "ריצה", excluded = false): ActivityRow {
  return {
    id,
    started_at: at.toISOString(),
    activity_type: type,
    duration_seconds: minutes * 60,
    distance_m: 5000,
    calories_active_kcal: activeKcal,
    calories_total_kcal: null,
    calories_source: "manual",
    external_provider: null,
    excluded_from_balance: excluded,
    notes: null,
  };
}

const D = (dayOfMonth: number, hour = 12) => new Date(2026, 10, dayOfMonth, hour, 0);
const energy = { bmr: 1780, baselineKcal: 2000 };

const days: { day: number; data: DayData | null }[] = [
  {
    day: 100,
    data: {
      foods: [food("a", D(9), 1500, 100)],
      drinks: [drink("w1", D(9), 2600)],
      activities: [run("r1", D(9, 7), 30, 300), run("s1", D(9, 18), 60, 250, "אימון כוח")],
      weights: [],
    },
  },
  { day: 101, data: null },
  {
    day: 102,
    data: {
      foods: [food("b", D(11), 2300, 60)],
      drinks: [drink("w2", D(11), 1000, 100)],
      activities: [run("r2", D(11, 7), 45, 400), run("dup", D(11, 7), 45, 400, "ריצה", true)],
      weights: [],
    },
  },
  { day: 103, data: { foods: [], drinks: [drink("w3", D(12), 2500)], activities: [], weights: [] } },
];

test("report averages cover documented days only", () => {
  const report = buildReport({
    days,
    energy,
    proteinGoalG: 90,
    waterGoalMl: 2500,
    weightAverage: [
      { day: 90, value: 84 },
      { day: 100, value: 82.5 },
      { day: 103, value: 82.1 },
    ],
  });
  assert.equal(report.totalDays, 4);
  assert.equal(report.documentedDays, 2);
  near(report.averageConsumedKcal, (1500 + 2400) / 2);
  // day 100 burns 2000 + 550, day 102 burns 2000 + 400
  near(report.averageBurnedKcal, (2550 + 2400) / 2);
  near(report.averageBalanceKcal, (-1050 + 0) / 2);
  near(report.averageProteinG, 80);
  assert.equal(report.cumulativeBalanceKcal, -1050);
  near(report.theoreticalChangeKg, -1050 / 7700, 1e-9);
  assert.equal(report.proteinGoalDays, 1);
  assert.equal(report.waterGoalDays, 2);
  near(report.weightChangeKg, -0.4);
});

test("report counts each workout once and groups by type", () => {
  const report = buildReport({ days, energy, proteinGoalG: null, waterGoalMl: 2500, weightAverage: [] });
  assert.equal(report.activityCount, 3);
  assert.equal(report.activitySeconds, (30 + 60 + 45) * 60);
  assert.equal(report.activeKcal, 950);
  assert.deepEqual(report.byActivityType, [
    { type: "ריצה", count: 2, seconds: 75 * 60, activeKcal: 700 },
    { type: "אימון כוח", count: 1, seconds: 3600, activeKcal: 250 },
  ]);
  assert.equal(report.proteinGoalDays, null);
  assert.equal(report.weightChangeKg, null);
});

test("an empty range and a missing expenditure estimate give nulls, not zeros", () => {
  const empty = buildReport({ days: [], energy, proteinGoalG: 90, waterGoalMl: 2500, weightAverage: [] });
  assert.equal(empty.documentedDays, 0);
  assert.equal(empty.averageConsumedKcal, null);
  assert.equal(empty.averageBalanceKcal, null);

  const noEnergy = buildReport({ days, energy: null, proteinGoalG: 90, waterGoalMl: 2500, weightAverage: [] });
  near(noEnergy.averageConsumedKcal, 1950);
  assert.equal(noEnergy.averageBurnedKcal, null);
  assert.equal(noEnergy.averageBalanceKcal, null);
  assert.equal(noEnergy.cumulativeBalanceKcal, 0);
});

// ------------------------------------------------------------------ CSV

test("CSV escapes quotes, commas and line breaks, and starts with a byte-order mark", () => {
  const csv = toCsv(["שם", "ערך"], [
    ["רגיל", 5],
    ['עם "מרכאות", ופסיק', null],
    ["שורה\nשנייה", 1.5],
  ]);
  assert.equal(csv, '﻿שם,ערך\r\nרגיל,5\r\n"עם ""מרכאות"", ופסיק",\r\n"שורה\nשנייה",1.5\r\n');
});

test("CSV neutralises cells that a spreadsheet would run as formulas", () => {
  const csv = toCsv(["a"], [["=SUM(A1)"], ["+1"], ["-2"], ["@x"], [-3]]);
  assert.equal(csv, "﻿a\r\n'=SUM(A1)\r\n'+1\r\n'-2\r\n'@x\r\n-3\r\n");
});

test("export has one row per item, in time order, with workouts as negative calories", () => {
  const data: DayData = {
    foods: [food("a", D(9, 13), 600, 40, "ai_estimate", true)],
    drinks: [drink("w", D(9, 8), 250, 86, 6.6)],
    activities: [run("r", D(9, 7), 30, 300)],
    weights: [
      { id: "x", measured_at: D(9, 6).toISOString(), weight_kg: 81.4, measurement_conditions: "בוקר", source: "manual", notes: null },
    ],
  };
  const rows = exportRows([data]);
  assert.deepEqual(
    rows.map((row) => row[2]),
    ["שקילה", "פעילות", "משקה", "מזון"],
  );
  assert.deepEqual(rows[0].slice(0, 6), ["2026-11-09", "06:00", "שקילה", "משקל", 81.4, 'ק"ג']);
  assert.equal(rows[1][6], -300);
  assert.equal(rows[1][4], 30);
  assert.equal(rows[2][7], 6.6);
  assert.equal(rows[3][6], 600);
  assert.equal(rows[3][11], "הערכת AI, תוקן");
  assert.match(String(rows[3][10]), /ארוחת צהריים/);
});

// ------------------------------------------------------------------ reminders

const quiet = {
  now: new Date(2026, 10, 12, 10, 0),
  lastWeighInAt: new Date(2026, 10, 11, 7, 0).toISOString(),
  previousDayHasFood: true,
  hasFoodToday: true,
  hydrationMl: 500,
  waterGoalMl: 2500,
  proteinG: 20,
  proteinGoalG: 140,
};

test("no reminders in the morning when everything is logged", () => {
  assert.deepEqual(buildInsights(quiet), []);
});

test("weigh-in reminder after four days, or when there was never a weigh-in", () => {
  const stale = buildInsights({ ...quiet, lastWeighInAt: new Date(2026, 10, 7, 7, 0).toISOString() });
  assert.deepEqual(stale.map((i) => i.key), ["weigh_in"]);
  assert.match(stale[0].text, /5 ימים/);
  assert.deepEqual(buildInsights({ ...quiet, lastWeighInAt: null }).map((i) => i.key), ["weigh_in"]);
  const recent = buildInsights({ ...quiet, lastWeighInAt: new Date(2026, 10, 9, 7, 0).toISOString() });
  assert.deepEqual(recent, []);
});

test("yesterday without food is mentioned; unknown is not", () => {
  assert.deepEqual(buildInsights({ ...quiet, previousDayHasFood: false }).map((i) => i.key), ["yesterday_food"]);
  assert.deepEqual(buildInsights({ ...quiet, previousDayHasFood: null }), []);
});

test("hydration and protein are mentioned only late in the day and only when clearly behind", () => {
  const evening = { ...quiet, now: new Date(2026, 10, 12, 20, 30) };
  assert.deepEqual(buildInsights(evening).map((i) => i.key), ["hydration", "protein"]);
  assert.deepEqual(buildInsights({ ...evening, hydrationMl: 2000, proteinG: 120 }), []);
  assert.deepEqual(buildInsights({ ...evening, hydrationMl: 2000, proteinGoalG: null }), []);
  assert.deepEqual(buildInsights({ ...evening, hydrationMl: 2000, hasFoodToday: false }), []);
  assert.deepEqual(buildInsights({ ...quiet, now: new Date(2026, 10, 12, 18, 30) }).map((i) => i.key), ["hydration"]);
});

// ------------------------------------------------------------------ favorites

const drinkRow = {
  id: "f1",
  kind: "drink",
  name: "קפה הפוך, חלב 1%",
  payload: { drinkType: "קפה הפוך, חלב 1%", volumeMl: 250, caloriesKcal: 86, caffeineMg: 80, hydrationMl: 250, proteinG: 6.6, carbsG: 9.8, fatG: 2 },
};

test("a stored drink favorite becomes a diary entry at the given time", () => {
  const favorite = parseFavorite(drinkRow);
  assert.ok(favorite && favorite.kind === "drink");
  assert.equal(favoriteCalories(favorite), 86);
  assert.equal(favoriteProtein(favorite), 6.6);
  const at = new Date(2026, 10, 12, 8, 0).toISOString();
  assert.deepEqual(drinkFromFavorite(favorite, at), {
    drinkType: "קפה הפוך, חלב 1%",
    volumeMl: 250,
    caloriesKcal: 86,
    caffeineMg: 80,
    hydrationMl: 250,
    proteinG: 6.6,
    carbsG: 9.8,
    fatG: 2,
    consumedAt: at,
    notes: null,
  });
});

test("a meal favorite round-trips through its stored payload", () => {
  const values = {
    name: "עוף ואורז",
    mealType: "lunch" as const,
    consumedAt: "2026-11-12T11:00:00.000Z",
    notes: "הערה",
    items: [
      { name: "חזה עוף", quantityG: 200, caloriesKcal: 330, proteinG: 62, carbsG: 0, fatG: 7.2 },
      { name: "אורז", quantityG: null, caloriesKcal: 234, proteinG: 4.3, carbsG: 51, fatG: 0.5 },
    ],
  };
  const favorite = parseFavorite({ id: "f2", kind: "meal", name: "עוף ואורז", payload: mealFavoritePayload(values) });
  assert.ok(favorite && favorite.kind === "meal");
  assert.equal(favoriteCalories(favorite), 564);
  near(favoriteProtein(favorite), 66.3);
  const entry = mealFromFavorite(favorite, "2026-11-13T10:00:00.000Z");
  assert.deepEqual(entry, { ...values, consumedAt: "2026-11-13T10:00:00.000Z", notes: null });
});

test("drink payload keeps every nutrition field", () => {
  const payload = drinkFavoritePayload({
    drinkType: "שייק חלבון",
    consumedAt: "x",
    volumeMl: 300,
    caloriesKcal: 120,
    caffeineMg: null,
    hydrationMl: 300,
    proteinG: 24,
    carbsG: 3,
    fatG: 1.5,
    notes: null,
  });
  assert.deepEqual(payload, {
    drinkType: "שייק חלבון",
    volumeMl: 300,
    caloriesKcal: 120,
    caffeineMg: null,
    hydrationMl: 300,
    proteinG: 24,
    carbsG: 3,
    fatG: 1.5,
  });
});

test("unusable favorites are rejected, and odd values are made safe", () => {
  assert.equal(parseFavorite({ id: "x", kind: "drink", name: "", payload: drinkRow.payload }), null);
  assert.equal(parseFavorite({ id: "x", kind: "drink", name: "a", payload: null }), null);
  assert.equal(parseFavorite({ id: "x", kind: "drink", name: "a", payload: { volumeMl: 0, caloriesKcal: 5 } }), null);
  assert.equal(parseFavorite({ id: "x", kind: "meal", name: "a", payload: { items: [] } }), null);
  assert.equal(parseFavorite({ id: "x", kind: "meal", name: "a", payload: { items: [{ name: "", caloriesKcal: 5 }] } }), null);
  assert.equal(parseFavorite({ id: "x", kind: "other", name: "a", payload: {} }), null);

  const odd = parseFavorite({
    id: "x",
    kind: "drink",
    name: "משקה",
    payload: { volumeMl: 200, caloriesKcal: 50, hydrationMl: 900, proteinG: -4, caffeineMg: "many" },
  });
  assert.ok(odd && odd.kind === "drink");
  assert.equal(odd.payload.hydrationMl, 200);
  assert.equal(odd.payload.proteinG, 0);
  assert.equal(odd.payload.caffeineMg, null);
  assert.equal(odd.payload.drinkType, "משקה");

  const meal = parseFavorite({ id: "y", kind: "meal", name: "m", payload: { mealType: "brunch", items: [{ name: "x", caloriesKcal: 10, quantityG: 0 }] } });
  assert.ok(meal && meal.kind === "meal");
  assert.equal(meal.payload.mealType, null);
  assert.equal(meal.payload.items[0].quantityG, null);
});
