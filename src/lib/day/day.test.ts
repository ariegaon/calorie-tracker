import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dayRangeIso,
  defaultEntryTime,
  isSameDay,
  parseLocalInputValue,
  relativeDayName,
  toLocalInputValue,
} from "./dates.ts";
import {
  validateActivity,
  validateDrink,
  validateFood,
  validateWeight,
  type ActivityRow,
  type DrinkRow,
  type FoodRow,
  type WeightRow,
} from "./entries.ts";
import { buildTimeline, summarizeDay } from "./summary.ts";

// Synthetic data only.

// ------------------------------------------------------------------ dates

test("datetime-local values round-trip through local time", () => {
  const date = new Date(2026, 10, 12, 7, 5);
  assert.equal(toLocalInputValue(date), "2026-11-12T07:05");
  assert.equal(parseLocalInputValue("2026-11-12T07:05")?.getTime(), date.getTime());
});

test("invalid datetime-local values are rejected", () => {
  assert.equal(parseLocalInputValue(""), null);
  assert.equal(parseLocalInputValue("2026-02-30T10:00"), null);
  assert.equal(parseLocalInputValue("2026-11-12T25:00"), null);
  assert.equal(parseLocalInputValue("2026-11-12"), null);
});

test("a day range covers exactly one local day", () => {
  const range = dayRangeIso(new Date(2026, 10, 12, 15, 30));
  assert.equal(new Date(range.from).getTime(), new Date(2026, 10, 12).getTime());
  assert.equal(new Date(range.to).getTime(), new Date(2026, 10, 13).getTime());
});

test("addDays crosses month and year boundaries", () => {
  assert.ok(isSameDay(addDays(new Date(2026, 11, 31), 1), new Date(2027, 0, 1)));
  assert.ok(isSameDay(addDays(new Date(2026, 2, 1), -1), new Date(2026, 1, 28)));
});

test("relative day names", () => {
  const today = new Date(2026, 10, 12, 9, 0);
  assert.equal(relativeDayName(new Date(2026, 10, 12, 23, 0), today), "today");
  assert.equal(relativeDayName(new Date(2026, 10, 11), today), "yesterday");
  assert.equal(relativeDayName(new Date(2026, 10, 13), today), "tomorrow");
  assert.equal(relativeDayName(new Date(2026, 10, 1), today), null);
});

test("new entries default to now for today and to noon for other days", () => {
  const now = new Date(2026, 10, 12, 16, 20);
  assert.equal(defaultEntryTime(new Date(2026, 10, 12), now).getTime(), now.getTime());
  assert.equal(defaultEntryTime(new Date(2026, 10, 10), now).getTime(), new Date(2026, 10, 10, 12, 0).getTime());
});

// ------------------------------------------------------------------ validation

const foodForm = {
  name: "חזה עוף עם אורז",
  mealType: "lunch",
  dateTime: "2026-11-12T13:00",
  quantityG: "350",
  calories: "620",
  protein: "45",
  carbs: "60",
  fat: "",
  notes: "",
};

test("a valid food form is converted to values", () => {
  const result = validateFood(foodForm);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.name, "חזה עוף עם אורז");
  assert.equal(result.values.mealType, "lunch");
  assert.equal(result.values.caloriesKcal, 620);
  assert.equal(result.values.proteinG, 45);
  assert.equal(result.values.fatG, 0);
  assert.equal(result.values.quantityG, 350);
  assert.equal(result.values.notes, null);
  assert.equal(new Date(result.values.consumedAt).getTime(), new Date(2026, 10, 12, 13, 0).getTime());
});

test("food needs a name and calories, and rejects impossible values", () => {
  const result = validateFood({ ...foodForm, name: " ", calories: "", protein: "-3", dateTime: "" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(Object.keys(result.errors).sort(), ["calories", "dateTime", "name", "protein"]);
});

test("food meal type is optional", () => {
  const result = validateFood({ ...foodForm, mealType: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.values.mealType, null);
  assert.equal(validateFood({ ...foodForm, mealType: "brunch" }).ok, false);
});

const drinkForm = {
  drinkType: "קפה עם חלב",
  dateTime: "2026-11-12T08:00",
  volumeMl: "240",
  calories: "110",
  caffeineMg: "80",
  hydrationMl: "",
  protein: "5.5",
  carbs: "",
  fat: "",
  notes: "",
};

test("a drink counts its full volume toward hydration unless told otherwise", () => {
  const result = validateDrink(drinkForm);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.hydrationMl, 240);
  assert.equal(result.values.caloriesKcal, 110);
  assert.equal(result.values.proteinG, 5.5);
  assert.equal(result.values.carbsG, 0);

  const partial = validateDrink({ ...drinkForm, hydrationMl: "100" });
  assert.equal(partial.ok && partial.values.hydrationMl, 100);
});

test("hydration cannot exceed the volume drunk", () => {
  const result = validateDrink({ ...drinkForm, hydrationMl: "500" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.hydrationMl);
});

test("a drink needs a type and a volume; calories default to zero", () => {
  assert.equal(validateDrink({ ...drinkForm, drinkType: "" }).ok, false);
  assert.equal(validateDrink({ ...drinkForm, volumeMl: "0" }).ok, false);
  const water = validateDrink({ ...drinkForm, drinkType: "מים", calories: "", caffeineMg: "" });
  assert.equal(water.ok, true);
  if (water.ok) {
    assert.equal(water.values.caloriesKcal, 0);
    assert.equal(water.values.caffeineMg, null);
  }
});

test("activity minutes and kilometers are stored as seconds and meters", () => {
  const result = validateActivity({
    activityType: "ריצה",
    dateTime: "2026-11-12T06:30",
    durationMin: "45",
    distanceKm: "8,2",
    activeKcal: "520",
    notes: " ריצת בוקר ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.durationSeconds, 2700);
  assert.equal(result.values.distanceM, 8200);
  assert.equal(result.values.caloriesActiveKcal, 520);
  assert.equal(result.values.notes, "ריצת בוקר");
});

test("activity needs a type and a duration; distance and calories are optional", () => {
  const base = { activityType: "אימון כוח", dateTime: "2026-11-12T18:00", durationMin: "60", distanceKm: "", activeKcal: "", notes: "" };
  const ok = validateActivity(base);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.values.distanceM, null);
    assert.equal(ok.values.caloriesActiveKcal, null);
  }
  assert.equal(validateActivity({ ...base, durationMin: "" }).ok, false);
  assert.equal(validateActivity({ ...base, activityType: "" }).ok, false);
  assert.equal(validateActivity({ ...base, durationMin: "2000" }).ok, false);
});

test("weight is range-checked and rounded to two decimals", () => {
  const result = validateWeight({ dateTime: "2026-11-12T07:00", weightKg: "81.456", conditions: "בוקר, לפני אוכל", notes: "" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.values.weightKg, 81.46);
    assert.equal(result.values.conditions, "בוקר, לפני אוכל");
  }
  assert.equal(validateWeight({ dateTime: "2026-11-12T07:00", weightKg: "20", conditions: "", notes: "" }).ok, false);
  assert.equal(validateWeight({ dateTime: "", weightKg: "80", conditions: "", notes: "" }).ok, false);
});

// ------------------------------------------------------------------ summary and timeline

function food(id: string, at: Date, kcal: number, protein: number, carbs: number, fat: number): FoodRow {
  return {
    id,
    consumed_at: at.toISOString(),
    name: `מנה ${id}`,
    meal_type: "lunch",
    source: "manual",
    notes: null,
    items: [
      {
        id: `${id}-item`,
        food_entry_id: id,
        food_name: `מנה ${id}`,
        quantity: null,
        quantity_unit: "g",
        calories_kcal: kcal,
        protein_g: protein,
        carbs_g: carbs,
        fat_g: fat,
      },
    ],
  };
}

function drink(id: string, at: Date, volume: number, kcal: number, caffeine: number | null, protein = 0): DrinkRow {
  return {
    id,
    consumed_at: at.toISOString(),
    drink_type: "משקה",
    volume_ml: volume,
    calories_kcal: kcal,
    caffeine_mg: caffeine,
    hydration_ml: volume,
    protein_g: protein,
    carbs_g: 0,
    fat_g: 0,
    notes: null,
  };
}

function activity(id: string, at: Date, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
    started_at: at.toISOString(),
    activity_type: "ריצה",
    duration_seconds: 3600,
    distance_m: 10000,
    calories_active_kcal: 500,
    calories_total_kcal: null,
    calories_source: "manual",
    external_provider: null,
    excluded_from_balance: false,
    notes: null,
    ...overrides,
  };
}

const weight: WeightRow = {
  id: "w1",
  measured_at: new Date(2026, 10, 12, 7, 0).toISOString(),
  weight_kg: 81.4,
  measurement_conditions: "בוקר, לפני אוכל",
  source: "manual",
  notes: null,
};

const day = {
  foods: [food("f1", new Date(2026, 10, 12, 8, 0), 400, 25, 40, 12), food("f2", new Date(2026, 10, 12, 13, 0), 700, 50, 70, 20)],
  drinks: [drink("d1", new Date(2026, 10, 12, 9, 0), 250, 0, null), drink("d2", new Date(2026, 10, 12, 10, 0), 240, 110, 80)],
  activities: [activity("a1", new Date(2026, 10, 12, 6, 0))],
  weights: [weight],
};

test("day summary adds up food, drinks, hydration and the balance", () => {
  const summary = summarizeDay(day, { bmr: 1780, baselineKcal: 2136 });
  assert.equal(summary.foodKcal, 1100);
  assert.equal(summary.drinkKcal, 110);
  assert.equal(summary.proteinG, 75);
  assert.equal(summary.carbsG, 110);
  assert.equal(summary.fatG, 32);
  assert.equal(summary.hydrationMl, 490);
  assert.equal(summary.caffeineMg, 80);
  assert.equal(summary.activity.activeKcal, 500);
  assert.equal(summary.hasFood, true);
  assert.deepEqual(summary.balance, { consumedKcal: 1210, burnedKcal: 2636, balanceKcal: -1426, status: "deficit" });
});

test("a duplicate workout does not change the day's balance", () => {
  const withDuplicate = {
    ...day,
    activities: [...day.activities, activity("a2", new Date(2026, 10, 12, 6, 5), { excluded_from_balance: true })],
  };
  const summary = summarizeDay(withDuplicate, { bmr: 1780, baselineKcal: 2136 });
  assert.equal(summary.activity.activeKcal, 500);
  assert.equal(summary.activity.excluded, 1);
  assert.equal(summary.balance?.burnedKcal, 2636);
});

test("without profile data there is no balance, and an empty day is flagged", () => {
  const summary = summarizeDay({ foods: [], drinks: [], activities: [], weights: [] }, null);
  assert.equal(summary.balance, null);
  assert.equal(summary.hasFood, false);
  assert.equal(summary.foodKcal, 0);
});

test("numeric strings from the database are summed as numbers", () => {
  const rows = { ...day, foods: [food("f1", new Date(2026, 10, 12, 8, 0), "400.50" as unknown as number, 25, 40, 12)] };
  assert.equal(summarizeDay(rows, null).foodKcal, 400.5);
});

test("timeline is chronological and signs calories by direction", () => {
  const timeline = buildTimeline(day, 1780);
  assert.deepEqual(
    timeline.map((event) => event.key),
    ["activity-a1", "weight-w1", "food-f1", "drink-d1", "drink-d2", "food-f2"],
  );
  assert.equal(timeline[0].kcal, -500);
  assert.equal(timeline[1].kcal, null);
  assert.equal(timeline[2].kcal, 400);
  assert.match(timeline[0].detail, /60 דק'/);
  assert.match(timeline[0].detail, /10\.0 ק"מ/);
});

test("timeline marks workouts that are not counted", () => {
  const data = {
    foods: [],
    drinks: [],
    weights: [],
    activities: [
      activity("dup", new Date(2026, 10, 12, 6, 0), { excluded_from_balance: true }),
      activity("total", new Date(2026, 10, 12, 7, 0), {
        calories_active_kcal: null,
        calories_total_kcal: 300,
        duration_seconds: null,
      }),
    ],
  };
  const timeline = buildTimeline(data, 1780);
  assert.equal(timeline[0].kcal, null);
  assert.match(timeline[0].detail, /כפילות/);
  assert.equal(timeline[1].kcal, null);
  assert.match(timeline[1].detail, /חסר משך/);
});

test("protein from drinks counts toward the day's protein", () => {
  const withShake = { ...day, drinks: [...day.drinks, drink("d3", new Date(2026, 10, 12, 17, 0), 300, 120, null, 24)] };
  const summary = summarizeDay(withShake, { bmr: 1780, baselineKcal: 2136 });
  assert.equal(summary.proteinG, 99);
  assert.equal(summary.drinkKcal, 230);
  const shake = buildTimeline(withShake, 1780).find((event) => event.key === "drink-d3");
  assert.match(shake?.detail ?? "", /24 גרם חלבון/);
});
