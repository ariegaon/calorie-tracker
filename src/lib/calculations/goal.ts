// Daily intake planning: the pace that reaches a target weight by a date, how much is left to eat
// today, and the allowance for snacks that never get logged. Pure functions.

/** Fastest weekly loss the app will plan for: 1% of body weight a week. */
export const MAX_WEEKLY_LOSS_FRACTION = 0.01;
/** Fastest weekly gain the app will plan for. */
export const MAX_WEEKLY_GAIN_KG = 0.5;
/** Closer than this to the target weight counts as reached. */
const REACHED_MARGIN_KG = 0.2;

const MS_PER_DAY = 86_400_000;

export type PaceForDate =
  /** The pace that reaches the target exactly on the date. */
  | { status: "ok"; weeklyKg: number; daysLeft: number }
  /** The date asks for more than is safe; the pace is held at the limit and the target is reached later. */
  | { status: "capped"; weeklyKg: number; requestedWeeklyKg: number; daysLeft: number; realisticDate: string }
  /** Already at the target weight: plan for maintenance. */
  | { status: "reached"; weeklyKg: 0; daysLeft: number }
  /** The date is today or already past: the date cannot be used. */
  | { status: "past" };

/** Days between two calendar days, ignoring the time of day. */
function daysBetween(from: Date, toIso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
  if (!match) return null;
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((end - start) / MS_PER_DAY);
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The fastest weekly change the app allows from this weight, in the direction of the target. */
export function safeWeeklyLimitKg(currentKg: number, losing: boolean): number {
  return losing ? -currentKg * MAX_WEEKLY_LOSS_FRACTION : MAX_WEEKLY_GAIN_KG;
}

/**
 * The weekly pace that takes `currentKg` to `targetKg` by `targetDate` (yyyy-mm-dd), never faster than
 * the safe limit. Recomputed every day from the latest weight, so it adjusts as the user goes.
 */
export function paceForTargetDate(currentKg: number, targetKg: number, today: Date, targetDate: string): PaceForDate {
  const daysLeft = daysBetween(today, targetDate);
  if (daysLeft === null || daysLeft <= 0) return { status: "past" };

  const diffKg = targetKg - currentKg;
  if (Math.abs(diffKg) < REACHED_MARGIN_KG) return { status: "reached", weeklyKg: 0, daysLeft };

  const requested = diffKg / (daysLeft / 7);
  const limit = safeWeeklyLimitKg(currentKg, diffKg < 0);
  const tooFast = diffKg < 0 ? requested < limit : requested > limit;
  if (!tooFast) return { status: "ok", weeklyKg: requested, daysLeft };

  const daysNeeded = Math.ceil((diffKg / limit) * 7);
  const realistic = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysNeeded);
  return { status: "capped", weeklyKg: limit, requestedWeeklyKg: requested, daysLeft, realisticDate: isoDay(realistic) };
}

export type RemainingToday = {
  /** What may be eaten today: the target plus the active calories of workouts that count. */
  budgetKcal: number;
  /** Budget minus what was eaten (snack allowance included). Negative means over. */
  remainingKcal: number;
  workoutKcal: number;
};

/** How much is left to eat today. Workout calories are added in full (the counted figure is already conservative). */
export function remainingToday(targetKcal: number, consumedKcal: number, workoutKcal: number): RemainingToday {
  const budgetKcal = targetKcal + Math.max(0, workoutKcal);
  return { budgetKcal, remainingKcal: budgetKcal - consumedKcal, workoutKcal: Math.max(0, workoutKcal) };
}

/** Share of the daily target suggested for unlogged snacks. */
export const SNACK_ALLOWANCE_SHARE = 0.07;
export const SNACK_ALLOWANCE_MIN_KCAL = 50;
export const SNACK_ALLOWANCE_MAX_KCAL = 300;
/** The most a user may set by hand. */
export const SNACK_ALLOWANCE_LIMIT_KCAL = 800;

/** Suggested daily allowance for unlogged snacks: 7% of the target, rounded to 10, between 50 and 300. */
export function suggestedSnackAllowance(targetKcal: number): number {
  const raw = Math.round((targetKcal * SNACK_ALLOWANCE_SHARE) / 10) * 10;
  return Math.min(SNACK_ALLOWANCE_MAX_KCAL, Math.max(SNACK_ALLOWANCE_MIN_KCAL, raw));
}

/** The allowance that applies to a day: nothing when it is off or the user marked the day as fully logged. */
export function snackAllowanceForDay(allowanceKcal: number | null, skipped: boolean): number {
  if (skipped || allowanceKcal === null || !Number.isFinite(allowanceKcal) || allowanceKcal <= 0) return 0;
  return Math.min(SNACK_ALLOWANCE_LIMIT_KCAL, Math.round(allowanceKcal));
}
