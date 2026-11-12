// Energy calculations: BMR, baseline expenditure, activity calories and daily balance.
// Pure functions with no imports. Every result here is an estimate, not a measurement.

export type Sex = "male" | "female";

/** Rough energy content of 1 kg of body weight. A first approximation only, not a physiological law. */
export const KCAL_PER_KG = 7700;

/** Daily intake below which a calorie target is not suggested. */
export const MIN_CALORIE_TARGET: Record<Sex, number> = { male: 1500, female: 1200 };

const SECONDS_PER_DAY = 86400;

/** Resting energy expenditure per day, Mifflin-St Jeor formula. */
export function bmrMifflinStJeor(input: { sex: Sex; weightKg: number; heightCm: number; ageYears: number }): number {
  const { sex, weightKg, heightCm, ageYears } = input;
  for (const value of [weightKg, heightCm, ageYears]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError("weight, height and age must be positive");
  }
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

/**
 * Daily expenditure without deliberate workouts: BMR times the everyday activity factor.
 * Workouts are added separately as active calories, so the factor must not include them.
 */
export function baselineExpenditure(bmr: number, activityFactor: number): number {
  if (!Number.isFinite(activityFactor) || activityFactor < 1 || activityFactor > 2.5) {
    throw new RangeError("activity factor out of range");
  }
  return bmr * activityFactor;
}

export type ActivityCalories = {
  caloriesActiveKcal: number | null;
  caloriesTotalKcal: number | null;
  durationSeconds: number | null;
  excludedFromBalance?: boolean;
};

export type ActiveCaloriesMethod =
  | "active_reported" // the source gave active calories directly
  | "total_minus_resting" // only total was given; resting share during the workout was subtracted
  | "total_not_separable" // only total was given and there is no duration, so nothing is added
  | "excluded" // marked as a duplicate
  | "no_calories";

export type ActiveCaloriesResult = { kcal: number; method: ActiveCaloriesMethod };

/**
 * Calories a workout adds on top of the baseline. Only the active part is added,
 * because the baseline already covers what the body would burn at rest in that time.
 */
export function activeCaloriesForActivity(activity: ActivityCalories, bmr: number): ActiveCaloriesResult {
  if (activity.excludedFromBalance) return { kcal: 0, method: "excluded" };

  if (activity.caloriesActiveKcal !== null) {
    return { kcal: Math.max(0, activity.caloriesActiveKcal), method: "active_reported" };
  }

  if (activity.caloriesTotalKcal !== null) {
    if (activity.durationSeconds === null || activity.durationSeconds <= 0) {
      return { kcal: 0, method: "total_not_separable" };
    }
    const restingDuringWorkout = (bmr * activity.durationSeconds) / SECONDS_PER_DAY;
    return { kcal: Math.max(0, activity.caloriesTotalKcal - restingDuringWorkout), method: "total_minus_resting" };
  }

  return { kcal: 0, method: "no_calories" };
}

export type DayActivitySummary = {
  activeKcal: number;
  countedActivities: number;
  /** Workouts with total calories only and no duration: shown to the user, not added automatically. */
  notSeparable: number;
  excluded: number;
};

export function sumActiveCalories(activities: ActivityCalories[], bmr: number): DayActivitySummary {
  const summary: DayActivitySummary = { activeKcal: 0, countedActivities: 0, notSeparable: 0, excluded: 0 };
  for (const activity of activities) {
    const result = activeCaloriesForActivity(activity, bmr);
    if (result.method === "excluded") summary.excluded += 1;
    else if (result.method === "total_not_separable") summary.notSeparable += 1;
    else if (result.method !== "no_calories") {
      summary.activeKcal += result.kcal;
      summary.countedActivities += 1;
    }
  }
  return summary;
}

export type BalanceStatus = "deficit" | "surplus" | "balanced";

export type DailyBalance = {
  consumedKcal: number;
  burnedKcal: number;
  /** consumed minus burned: negative is a deficit, positive is a surplus */
  balanceKcal: number;
  status: BalanceStatus;
};

/** Differences smaller than this are reported as "balanced": the inputs are not accurate enough to say more. */
export const BALANCE_TOLERANCE_KCAL = 50;

export function dailyBalance(input: {
  foodKcal: number;
  drinkKcal: number;
  baselineKcal: number;
  activeKcal: number;
}): DailyBalance {
  const consumedKcal = input.foodKcal + input.drinkKcal;
  const burnedKcal = input.baselineKcal + input.activeKcal;
  const balanceKcal = consumedKcal - burnedKcal;
  const status: BalanceStatus =
    Math.abs(balanceKcal) < BALANCE_TOLERANCE_KCAL ? "balanced" : balanceKcal < 0 ? "deficit" : "surplus";
  return { consumedKcal, burnedKcal, balanceKcal, status };
}

/** Weight change implied by a cumulative balance. Negative balance (deficit) gives a negative change. */
export function theoreticalWeightChangeKg(cumulativeBalanceKcal: number): number {
  return cumulativeBalanceKcal / KCAL_PER_KG;
}

export type CalorieTarget = {
  targetKcal: number;
  /** Daily deficit (negative) or surplus (positive) the chosen pace implies. */
  dailyAdjustmentKcal: number;
  /** True when the pace asked for less than the minimum and the target was raised to it. */
  limitedByMinimum: boolean;
};

/** Daily intake that matches a weekly weight-change pace, on a day without workouts. */
export function calorieTargetForPace(baselineKcal: number, weeklyGoalKg: number, sex: Sex): CalorieTarget {
  const dailyAdjustmentKcal = (weeklyGoalKg * KCAL_PER_KG) / 7;
  const raw = baselineKcal + dailyAdjustmentKcal;
  const minimum = MIN_CALORIE_TARGET[sex];
  if (raw < minimum) return { targetKcal: minimum, dailyAdjustmentKcal, limitedByMinimum: true };
  return { targetKcal: raw, dailyAdjustmentKcal, limitedByMinimum: false };
}
