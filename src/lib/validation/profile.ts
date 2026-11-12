// Pure validation of the profile form. No imports, so it runs under `node --test` as is.

export type ProfileForm = {
  displayName: string;
  sexForBmr: string;
  birthDate: string; // yyyy-mm-dd
  heightCm: string;
  startWeightKg: string;
  targetWeightKg: string;
  activityFactor: string;
  weeklyGoalKg: string;
  proteinGoalG: string;
  waterGoalMl: string;
};

export type ProfileValues = {
  displayName: string | null;
  sexForBmr: "male" | "female";
  birthDate: string;
  heightCm: number;
  startWeightKg: number;
  targetWeightKg: number;
  activityFactor: number;
  weeklyGoalKg: number;
  proteinGoalG: number | null;
  waterGoalMl: number;
};

export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>;

export type ProfileValidation =
  | { ok: true; values: ProfileValues }
  | { ok: false; errors: ProfileErrors };

export const ACTIVITY_FACTORS = [1.2, 1.35, 1.55] as const;
export const WEEKLY_GOALS_KG = [-0.75, -0.5, -0.25, 0, 0.25] as const;

const MIN_AGE = 18;
const MAX_AGE = 100;

/** Accepts "82", "82.5" and "82,5". Returns null for anything that is not a plain number. */
export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/** Full years between a yyyy-mm-dd birth date and `today`. Null if the date is not valid. */
export function ageInYears(birthDate: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  let age = today.getFullYear() - year;
  const beforeBirthday =
    today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

function numberInRange(
  raw: string,
  min: number,
  max: number,
  requiredMessage: string,
  rangeMessage: string,
): { value: number } | { error: string } {
  if (raw.trim() === "") return { error: requiredMessage };
  const value = parseNumber(raw);
  if (value === null) return { error: "יש להזין מספר" };
  if (value < min || value > max) return { error: rangeMessage };
  return { value };
}

export function validateProfile(form: ProfileForm, today: Date = new Date()): ProfileValidation {
  const errors: ProfileErrors = {};

  const displayName = form.displayName.trim();
  if (displayName.length > 40) errors.displayName = "עד 40 תווים";

  if (form.sexForBmr !== "male" && form.sexForBmr !== "female") {
    errors.sexForBmr = "יש לבחור מין לצורך נוסחת החישוב";
  }

  const age = ageInYears(form.birthDate, today);
  if (form.birthDate.trim() === "") errors.birthDate = "יש להזין תאריך לידה";
  else if (age === null) errors.birthDate = "תאריך לא תקין";
  else if (age < MIN_AGE || age > MAX_AGE) errors.birthDate = `הגיל צריך להיות בין ${MIN_AGE} ל-${MAX_AGE}`;

  const height = numberInRange(form.heightCm, 100, 250, "יש להזין גובה", "גובה בין 100 ל-250 ס\"מ");
  if ("error" in height) errors.heightCm = height.error;

  const startWeight = numberInRange(form.startWeightKg, 30, 300, "יש להזין משקל", "משקל בין 30 ל-300 ק\"ג");
  if ("error" in startWeight) errors.startWeightKg = startWeight.error;

  const targetWeight = numberInRange(
    form.targetWeightKg,
    30,
    300,
    "יש להזין משקל יעד",
    "משקל בין 30 ל-300 ק\"ג",
  );
  if ("error" in targetWeight) errors.targetWeightKg = targetWeight.error;

  const activityFactor = parseNumber(form.activityFactor);
  if (activityFactor === null || !ACTIVITY_FACTORS.some((f) => f === activityFactor)) {
    errors.activityFactor = "יש לבחור רמת פעילות";
  }

  const weeklyGoal = parseNumber(form.weeklyGoalKg);
  if (weeklyGoal === null || !WEEKLY_GOALS_KG.some((g) => g === weeklyGoal)) {
    errors.weeklyGoalKg = "יש לבחור קצב";
  }

  let proteinGoal: number | null = null;
  if (form.proteinGoalG.trim() !== "") {
    const protein = numberInRange(form.proteinGoalG, 0, 400, "", "חלבון בין 0 ל-400 גרם");
    if ("error" in protein) errors.proteinGoalG = protein.error;
    else proteinGoal = Math.round(protein.value);
  }

  const water = numberInRange(form.waterGoalMl, 500, 10000, "יש להזין יעד שתייה", "בין 500 ל-10,000 מ\"ל");
  if ("error" in water) errors.waterGoalMl = water.error;

  // The chosen pace has to point toward the target weight.
  if (!("error" in startWeight) && !("error" in targetWeight) && weeklyGoal !== null && !errors.weeklyGoalKg) {
    const diff = targetWeight.value - startWeight.value;
    if (diff < 0 && weeklyGoal > 0) errors.weeklyGoalKg = "היעד נמוך מהמשקל הנוכחי, אז הקצב צריך להיות ירידה או שמירה";
    if (diff > 0 && weeklyGoal < 0) errors.weeklyGoalKg = "היעד גבוה מהמשקל הנוכחי, אז הקצב צריך להיות עלייה או שמירה";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      displayName: displayName === "" ? null : displayName,
      sexForBmr: form.sexForBmr as "male" | "female",
      birthDate: form.birthDate,
      heightCm: (height as { value: number }).value,
      startWeightKg: (startWeight as { value: number }).value,
      targetWeightKg: (targetWeight as { value: number }).value,
      activityFactor: activityFactor as number,
      weeklyGoalKg: weeklyGoal as number,
      proteinGoalG: proteinGoal,
      waterGoalMl: Math.round((water as { value: number }).value),
    },
  };
}
