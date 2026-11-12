// Row types for a day's entries, form validation and drink presets. Pure code.

import { parseNumber } from "../validation/profile.ts";
import { parseLocalInputValue } from "./dates.ts";

// ------------------------------------------------------------------ rows

export type FoodItemRow = {
  id: string;
  food_entry_id: string;
  food_name: string;
  quantity: number | null;
  quantity_unit: "g" | "ml" | "unit";
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence?: number | null;
  source?: string;
  user_corrected?: boolean;
};

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type FoodRow = {
  id: string;
  consumed_at: string;
  name: string | null;
  meal_type: MealType | null;
  source: string;
  notes: string | null;
  items: FoodItemRow[];
};

export type DrinkRow = {
  id: string;
  consumed_at: string;
  drink_type: string;
  volume_ml: number;
  calories_kcal: number;
  caffeine_mg: number | null;
  hydration_ml: number;
  notes: string | null;
};

export type ActivityRow = {
  id: string;
  started_at: string;
  activity_type: string;
  duration_seconds: number | null;
  distance_m: number | null;
  calories_active_kcal: number | null;
  calories_total_kcal: number | null;
  calories_source: string;
  external_provider: string | null;
  excluded_from_balance: boolean;
  notes: string | null;
};

export type WeightRow = {
  id: string;
  measured_at: string;
  weight_kg: number;
  measurement_conditions: string | null;
  source: string;
  notes: string | null;
};

// ------------------------------------------------------------------ options

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "ארוחת בוקר",
  lunch: "ארוחת צהריים",
  dinner: "ארוחת ערב",
  snack: "נשנוש",
};

export const ACTIVITY_TYPES = ["ריצה", "הליכה", "רכיבה", "אימון כוח", "CrossFit", "שחייה", "אחר"] as const;

export const WEIGHT_CONDITIONS = ["בוקר, לפני אוכל", "אחרי אימון", "ערב", "אחר"] as const;

export type DrinkPreset = {
  key: string;
  label: string;
  drinkType: string;
  volumeMl: number;
  caloriesKcal: number;
  caffeineMg: number;
  hydrationMl: number;
};

/** Typical values. Calories and caffeine are estimates and can be edited before saving. */
export const DRINK_PRESETS: DrinkPreset[] = [
  { key: "water_glass", label: "כוס מים", drinkType: "מים", volumeMl: 250, caloriesKcal: 0, caffeineMg: 0, hydrationMl: 250 },
  { key: "water_bottle", label: "בקבוק מים", drinkType: "מים", volumeMl: 500, caloriesKcal: 0, caffeineMg: 0, hydrationMl: 500 },
  { key: "espresso", label: "אספרסו", drinkType: "אספרסו", volumeMl: 40, caloriesKcal: 2, caffeineMg: 65, hydrationMl: 40 },
  { key: "americano", label: "אמריקנו", drinkType: "אמריקנו", volumeMl: 240, caloriesKcal: 5, caffeineMg: 95, hydrationMl: 240 },
  { key: "coffee_milk", label: "קפה עם חלב", drinkType: "קפה עם חלב", volumeMl: 240, caloriesKcal: 110, caffeineMg: 80, hydrationMl: 240 },
  { key: "tea", label: "תה", drinkType: "תה", volumeMl: 240, caloriesKcal: 2, caffeineMg: 40, hydrationMl: 240 },
  { key: "juice", label: "מיץ", drinkType: "מיץ", volumeMl: 250, caloriesKcal: 115, caffeineMg: 0, hydrationMl: 250 },
  { key: "soft_drink", label: "משקה קל", drinkType: "משקה קל", volumeMl: 330, caloriesKcal: 140, caffeineMg: 0, hydrationMl: 330 },
];

// ------------------------------------------------------------------ validation helpers

type Errors<T> = Partial<Record<keyof T, string>>;
export type Validation<TForm, TValues> = { ok: true; values: TValues } | { ok: false; errors: Errors<TForm> };

function requiredNumber(raw: string, min: number, max: number, label: string): { value: number } | { error: string } {
  if (raw.trim() === "") return { error: `יש להזין ${label}` };
  const value = parseNumber(raw);
  if (value === null) return { error: "יש להזין מספר" };
  if (value < min || value > max) return { error: `הערך צריך להיות בין ${min} ל-${max}` };
  return { value };
}

function optionalNumber(raw: string, min: number, max: number): { value: number | null } | { error: string } {
  if (raw.trim() === "") return { value: null };
  const value = parseNumber(raw);
  if (value === null) return { error: "יש להזין מספר" };
  if (value < min || value > max) return { error: `הערך צריך להיות בין ${min} ל-${max}` };
  return { value };
}

function dateTime(raw: string): { value: string } | { error: string } {
  const parsed = parseLocalInputValue(raw);
  if (!parsed) return { error: "יש לבחור תאריך ושעה" };
  return { value: parsed.toISOString() };
}

function cleanNotes(raw: string): string | null {
  const text = raw.trim();
  return text === "" ? null : text.slice(0, 500);
}

// ------------------------------------------------------------------ food

export type FoodForm = {
  name: string;
  mealType: string;
  dateTime: string;
  quantityG: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  notes: string;
};

export type FoodValues = {
  name: string;
  mealType: MealType | null;
  consumedAt: string;
  quantityG: number | null;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  notes: string | null;
};

export function validateFood(form: FoodForm): Validation<FoodForm, FoodValues> {
  const errors: Errors<FoodForm> = {};

  const name = form.name.trim();
  if (name === "") errors.name = "יש להזין מה אכלת";
  else if (name.length > 80) errors.name = "עד 80 תווים";

  const mealType = form.mealType === "" ? null : form.mealType;
  if (mealType !== null && !(mealType in MEAL_TYPE_LABELS)) errors.mealType = "סוג ארוחה לא מוכר";

  const at = dateTime(form.dateTime);
  if ("error" in at) errors.dateTime = at.error;

  const quantity = optionalNumber(form.quantityG, 1, 5000);
  if ("error" in quantity) errors.quantityG = quantity.error;

  const calories = requiredNumber(form.calories, 0, 5000, "קלוריות");
  if ("error" in calories) errors.calories = calories.error;

  const protein = optionalNumber(form.protein, 0, 500);
  if ("error" in protein) errors.protein = protein.error;
  const carbs = optionalNumber(form.carbs, 0, 1000);
  if ("error" in carbs) errors.carbs = carbs.error;
  const fat = optionalNumber(form.fat, 0, 500);
  if ("error" in fat) errors.fat = fat.error;

  if (
    "error" in at ||
    "error" in quantity ||
    "error" in calories ||
    "error" in protein ||
    "error" in carbs ||
    "error" in fat ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name,
      mealType: mealType as MealType | null,
      consumedAt: at.value,
      quantityG: quantity.value,
      caloriesKcal: calories.value,
      proteinG: protein.value ?? 0,
      carbsG: carbs.value ?? 0,
      fatG: fat.value ?? 0,
      notes: cleanNotes(form.notes),
    },
  };
}

// ------------------------------------------------------------------ drink

export type DrinkForm = {
  drinkType: string;
  dateTime: string;
  volumeMl: string;
  calories: string;
  caffeineMg: string;
  hydrationMl: string;
  notes: string;
};

export type DrinkValues = {
  drinkType: string;
  consumedAt: string;
  volumeMl: number;
  caloriesKcal: number;
  caffeineMg: number | null;
  hydrationMl: number;
  notes: string | null;
};

export function validateDrink(form: DrinkForm): Validation<DrinkForm, DrinkValues> {
  const errors: Errors<DrinkForm> = {};

  const drinkType = form.drinkType.trim();
  if (drinkType === "") errors.drinkType = "יש להזין סוג משקה";
  else if (drinkType.length > 40) errors.drinkType = "עד 40 תווים";

  const at = dateTime(form.dateTime);
  if ("error" in at) errors.dateTime = at.error;

  const volume = requiredNumber(form.volumeMl, 1, 5000, "כמות");
  if ("error" in volume) errors.volumeMl = volume.error;

  const calories = optionalNumber(form.calories, 0, 2000);
  if ("error" in calories) errors.calories = calories.error;

  const caffeine = optionalNumber(form.caffeineMg, 0, 1000);
  if ("error" in caffeine) errors.caffeineMg = caffeine.error;

  const hydration = optionalNumber(form.hydrationMl, 0, 5000);
  if ("error" in hydration) errors.hydrationMl = hydration.error;

  if (
    "error" in at ||
    "error" in volume ||
    "error" in calories ||
    "error" in caffeine ||
    "error" in hydration ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const volumeMl = Math.round(volume.value);
  const hydrationMl = Math.round(hydration.value ?? volumeMl);
  if (hydrationMl > volumeMl) {
    return { ok: false, errors: { hydrationMl: "הנוזלים שנזקפים ליעד לא יכולים לעלות על הכמות ששתית" } };
  }

  return {
    ok: true,
    values: {
      drinkType,
      consumedAt: at.value,
      volumeMl,
      caloriesKcal: calories.value ?? 0,
      caffeineMg: caffeine.value,
      hydrationMl,
      notes: cleanNotes(form.notes),
    },
  };
}

// ------------------------------------------------------------------ activity

export type ActivityForm = {
  activityType: string;
  dateTime: string;
  durationMin: string;
  distanceKm: string;
  activeKcal: string;
  notes: string;
};

export type ActivityValues = {
  activityType: string;
  startedAt: string;
  durationSeconds: number;
  distanceM: number | null;
  caloriesActiveKcal: number | null;
  notes: string | null;
};

export function validateActivity(form: ActivityForm): Validation<ActivityForm, ActivityValues> {
  const errors: Errors<ActivityForm> = {};

  const activityType = form.activityType.trim();
  if (activityType === "") errors.activityType = "יש לבחור סוג פעילות";
  else if (activityType.length > 40) errors.activityType = "עד 40 תווים";

  const at = dateTime(form.dateTime);
  if ("error" in at) errors.dateTime = at.error;

  const duration = requiredNumber(form.durationMin, 1, 1440, "משך בדקות");
  if ("error" in duration) errors.durationMin = duration.error;

  const distance = optionalNumber(form.distanceKm, 0, 500);
  if ("error" in distance) errors.distanceKm = distance.error;

  const active = optionalNumber(form.activeKcal, 0, 10000);
  if ("error" in active) errors.activeKcal = active.error;

  if (
    "error" in at ||
    "error" in duration ||
    "error" in distance ||
    "error" in active ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      activityType,
      startedAt: at.value,
      durationSeconds: Math.round(duration.value * 60),
      distanceM: distance.value === null ? null : Math.round(distance.value * 1000),
      caloriesActiveKcal: active.value,
      notes: cleanNotes(form.notes),
    },
  };
}

// ------------------------------------------------------------------ weight

export type WeightForm = {
  dateTime: string;
  weightKg: string;
  conditions: string;
  notes: string;
};

export type WeightValues = {
  measuredAt: string;
  weightKg: number;
  conditions: string | null;
  notes: string | null;
};

export function validateWeight(form: WeightForm): Validation<WeightForm, WeightValues> {
  const errors: Errors<WeightForm> = {};

  const at = dateTime(form.dateTime);
  if ("error" in at) errors.dateTime = at.error;

  const weight = requiredNumber(form.weightKg, 30, 300, "משקל");
  if ("error" in weight) errors.weightKg = weight.error;

  if ("error" in at || "error" in weight) return { ok: false, errors };

  const conditions = form.conditions.trim();
  return {
    ok: true,
    values: {
      measuredAt: at.value,
      weightKg: Math.round(weight.value * 100) / 100,
      conditions: conditions === "" ? null : conditions.slice(0, 60),
      notes: cleanNotes(form.notes),
    },
  };
}

// ------------------------------------------------------------------ meal with several items

export type MealItemForm = {
  name: string;
  quantityG: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

export type MealForm = {
  name: string;
  mealType: string;
  dateTime: string;
  notes: string;
  items: MealItemForm[];
};

export type MealItemValues = {
  name: string;
  quantityG: number | null;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type MealValues = {
  name: string;
  mealType: MealType | null;
  consumedAt: string;
  notes: string | null;
  items: MealItemValues[];
};

export type MealErrors = {
  name?: string;
  mealType?: string;
  dateTime?: string;
  /** General problem with the list, such as having no items. */
  items?: string;
  /** Per item, in the same order as the form's items. */
  itemErrors: Partial<Record<keyof MealItemForm, string>>[];
};

export type MealValidation = { ok: true; values: MealValues } | { ok: false; errors: MealErrors };

export const MAX_MEAL_ITEMS = 20;

export function validateMeal(form: MealForm): MealValidation {
  const errors: MealErrors = { itemErrors: form.items.map(() => ({})) };
  let failed = false;

  const mealType = form.mealType === "" ? null : form.mealType;
  if (mealType !== null && !(mealType in MEAL_TYPE_LABELS)) {
    errors.mealType = "סוג ארוחה לא מוכר";
    failed = true;
  }

  const at = dateTime(form.dateTime);
  if ("error" in at) {
    errors.dateTime = at.error;
    failed = true;
  }

  if (form.items.length === 0) {
    errors.items = "יש להוסיף לפחות מרכיב אחד";
    failed = true;
  } else if (form.items.length > MAX_MEAL_ITEMS) {
    errors.items = `עד ${MAX_MEAL_ITEMS} מרכיבים בארוחה`;
    failed = true;
  }

  const items: MealItemValues[] = [];
  form.items.forEach((item, index) => {
    const itemErrors = errors.itemErrors[index];
    const name = item.name.trim();
    if (name === "") itemErrors.name = "חסר שם";
    else if (name.length > 80) itemErrors.name = "עד 80 תווים";

    const quantity = optionalNumber(item.quantityG, 1, 5000);
    if ("error" in quantity) itemErrors.quantityG = quantity.error;
    const calories = requiredNumber(item.calories, 0, 5000, "קלוריות");
    if ("error" in calories) itemErrors.calories = calories.error;
    const protein = optionalNumber(item.protein, 0, 500);
    if ("error" in protein) itemErrors.protein = protein.error;
    const carbs = optionalNumber(item.carbs, 0, 1000);
    if ("error" in carbs) itemErrors.carbs = carbs.error;
    const fat = optionalNumber(item.fat, 0, 500);
    if ("error" in fat) itemErrors.fat = fat.error;

    if (
      "error" in quantity ||
      "error" in calories ||
      "error" in protein ||
      "error" in carbs ||
      "error" in fat ||
      Object.keys(itemErrors).length > 0
    ) {
      failed = true;
      return;
    }
    items.push({
      name,
      quantityG: quantity.value,
      caloriesKcal: calories.value,
      proteinG: protein.value ?? 0,
      carbsG: carbs.value ?? 0,
      fatG: fat.value ?? 0,
    });
  });

  const typedName = form.name.trim();
  if (typedName.length > 80) {
    errors.name = "עד 80 תווים";
    failed = true;
  }

  if (failed || "error" in at) return { ok: false, errors };

  return {
    ok: true,
    values: {
      // Without a typed name, the meal is named after its items.
      name: typedName !== "" ? typedName : items.map((item) => item.name).join(", ").slice(0, 80),
      mealType: mealType as MealType | null,
      consumedAt: at.value,
      notes: cleanNotes(form.notes),
      items,
    },
  };
}
