// Weight trend, forecasts, data quality and calibration insight. Pure code with no imports.
// Every number produced here is an estimate. The constants below are stated assumptions, not physiology.

export const KCAL_PER_KG = 7700;

/** Days of history a trend or calorie average looks at. */
export const WINDOW_DAYS = 28;

// Minimum data before a figure is shown at all.
export const MIN_TREND_WEIGH_DAYS = 5;
export const MIN_TREND_SPAN_DAYS = 10;
export const MIN_DOCUMENTED_DAYS = 7;

// Minimum data before measured and calculated change are compared.
export const MIN_CALIBRATION_SPAN_DAYS = 21;
export const MIN_CALIBRATION_WEIGH_DAYS = 8;
export const MIN_CALIBRATION_DOCUMENTED_DAYS = 14;
/** Gaps smaller than this between measured and calculated change are treated as agreement. */
export const CALIBRATION_TOLERANCE_KCAL = 150;

const MS_PER_DAY = 86_400_000;

// ------------------------------------------------------------------ days

/** Whole-day number of a date in the device's local time zone. Consecutive days differ by exactly 1. */
export function dayIndex(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

/** Local midnight of a day number. */
export function dateOfDay(day: number): Date {
  const utc = new Date(day * MS_PER_DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

// ------------------------------------------------------------------ weigh-ins

export type WeighIn = { at: string; weightKg: number };

export type DailyWeight = { day: number; weightKg: number; count: number };

/** One value per day: the mean of that day's weigh-ins, oldest first. */
export function dailyWeights(weighIns: WeighIn[]): DailyWeight[] {
  const byDay = new Map<number, { sum: number; count: number }>();
  for (const weighIn of weighIns) {
    const weight = Number(weighIn.weightKg);
    const time = new Date(weighIn.at);
    if (!Number.isFinite(weight) || Number.isNaN(time.getTime())) continue;
    const day = dayIndex(time);
    const bucket = byDay.get(day) ?? { sum: 0, count: 0 };
    bucket.sum += weight;
    bucket.count += 1;
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .map(([day, bucket]) => ({ day, weightKg: bucket.sum / bucket.count, count: bucket.count }))
    .sort((a, b) => a.day - b.day);
}

export type AveragePoint = { day: number; value: number };

/** Trailing moving average: for each weigh day, the mean of the weigh days in the window ending on it. */
export function movingAverage(daily: DailyWeight[], windowDays = 7): AveragePoint[] {
  return daily.map((point, index) => {
    let sum = 0;
    let count = 0;
    for (let i = index; i >= 0 && daily[i].day > point.day - windowDays; i -= 1) {
      sum += daily[i].weightKg;
      count += 1;
    }
    return { day: point.day, value: sum / count };
  });
}

// ------------------------------------------------------------------ trend from the scale

export type TrendFit = {
  slopeKgPerDay: number;
  /** Fitted weight on the last day of the window ("today"). */
  valueAtEnd: number;
  /** Typical distance of a single day's weight from the fitted line. */
  residualSd: number;
  slopeSe: number;
  weighDays: number;
  spanDays: number;
};

/** Straight-line fit through the daily weights of the window. Null when there is too little data. */
export function fitTrend(daily: DailyWeight[], endDay: number, windowDays = WINDOW_DAYS): TrendFit | null {
  const points = daily.filter((point) => point.day <= endDay && point.day > endDay - windowDays);
  if (points.length < MIN_TREND_WEIGH_DAYS) return null;
  const spanDays = points[points.length - 1].day - points[0].day;
  if (spanDays < MIN_TREND_SPAN_DAYS) return null;

  const n = points.length;
  // x is measured back from the end day, so the intercept is the fitted value "today".
  const xs = points.map((point) => point.day - endDay);
  const ys = points.map((point) => point.weightKg);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let squaredResiduals = 0;
  for (let i = 0; i < n; i += 1) squaredResiduals += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const residualSd = n > 2 ? Math.sqrt(squaredResiduals / (n - 2)) : 0;

  return {
    slopeKgPerDay: slope,
    valueAtEnd: intercept,
    residualSd,
    slopeSe: residualSd / Math.sqrt(sxx),
    weighDays: n,
    spanDays,
  };
}

// ------------------------------------------------------------------ trend from the calorie balance

export type DayBalance = {
  day: number;
  /** Consumed minus burned. Negative is a deficit. */
  balanceKcal: number;
  /** False when no food was logged that day: such days are left out, not counted as fasting. */
  documented: boolean;
};

export type CalorieTrend = {
  averageBalanceKcal: number;
  slopeKgPerDay: number;
  documentedDays: number;
};

export function calorieTrend(days: DayBalance[], endDay: number, windowDays = WINDOW_DAYS): CalorieTrend | null {
  const documented = days.filter((d) => d.documented && d.day <= endDay && d.day > endDay - windowDays);
  if (documented.length < MIN_DOCUMENTED_DAYS) return null;
  const average = documented.reduce((sum, d) => sum + d.balanceKcal, 0) / documented.length;
  return { averageBalanceKcal: average, slopeKgPerDay: average / KCAL_PER_KG, documentedDays: documented.length };
}

export type MonthToDate = {
  cumulativeBalanceKcal: number;
  averageBalanceKcal: number | null;
  theoreticalChangeKg: number;
  documentedDays: number;
  elapsedDays: number;
};

export function monthToDate(days: DayBalance[], monthStartDay: number, today: number): MonthToDate {
  const documented = days.filter((d) => d.documented && d.day >= monthStartDay && d.day <= today);
  const cumulative = documented.reduce((sum, d) => sum + d.balanceKcal, 0);
  return {
    cumulativeBalanceKcal: cumulative,
    averageBalanceKcal: documented.length > 0 ? cumulative / documented.length : null,
    theoreticalChangeKg: cumulative / KCAL_PER_KG,
    documentedDays: documented.length,
    elapsedDays: today - monthStartDay + 1,
  };
}

// ------------------------------------------------------------------ forecast

export type Estimate = { weightKg: number; lowKg: number; highKg: number };

export type Forecast = {
  daysAhead: number;
  /** Simple arithmetic from the average calorie balance. */
  theoretical: Estimate | null;
  /** Continuation of the measured weight trend. */
  trend: Estimate | null;
  /** Both together. Only when both exist. */
  combined: Estimate | null;
};

function estimate(weightKg: number, halfWidth: number): Estimate {
  return { weightKg, lowKg: weightKg - halfWidth, highKg: weightKg + halfWidth };
}

/** Weight given to the measured trend in the combined forecast; the rest goes to the calorie balance. */
export const TREND_SHARE = 0.6;

export function forecastWeight(input: {
  today: number;
  targetDay: number;
  /** Best current weight when there is no fitted trend: the latest moving average or weigh-in. */
  currentWeightKg: number | null;
  trend: TrendFit | null;
  calories: CalorieTrend | null;
}): Forecast {
  const daysAhead = Math.max(0, input.targetDay - input.today);
  const base = input.trend?.valueAtEnd ?? input.currentWeightKg;

  let theoretical: Estimate | null = null;
  if (input.calories && base !== null) {
    const change = input.calories.slopeKgPerDay * daysAhead;
    // Food logging and expenditure formulas are each off by a wide margin; a third of the change
    // plus half a kilo of day-to-day fluctuation is the stated allowance.
    theoretical = estimate(base + change, 0.5 + Math.abs(change) * 0.35);
  }

  let trend: Estimate | null = null;
  if (input.trend) {
    const spread = Math.sqrt(input.trend.residualSd ** 2 + (input.trend.slopeSe * daysAhead) ** 2);
    trend = estimate(input.trend.valueAtEnd + input.trend.slopeKgPerDay * daysAhead, Math.max(0.4, 1.64 * spread));
  }

  let combined: Estimate | null = null;
  if (input.trend && input.calories && trend) {
    const slope = TREND_SHARE * input.trend.slopeKgPerDay + (1 - TREND_SHARE) * input.calories.slopeKgPerDay;
    const disagreement = Math.abs(input.trend.slopeKgPerDay - input.calories.slopeKgPerDay) * daysAhead;
    const halfWidth = Math.max(trend.highKg - trend.weightKg, 0.4 + disagreement / 2);
    combined = estimate(input.trend.valueAtEnd + slope * daysAhead, halfWidth);
  }

  return { daysAhead, theoretical, trend, combined };
}

// ------------------------------------------------------------------ reaching the goal

export type GoalEta =
  | { status: "reached" }
  | { status: "wrong_direction" }
  | { status: "too_slow" }
  | { status: "eta"; days: number; earliestDays: number; latestDays: number | null };

const MIN_GOAL_SLOPE = 0.005; // kg per day, about 35 g a week
const MAX_GOAL_DAYS = 730;

/** Days until the goal at the measured pace, with a range from the uncertainty of that pace. */
export function goalEta(currentKg: number, targetKg: number, slopeKgPerDay: number, slopeSe: number): GoalEta {
  const remaining = targetKg - currentKg;
  if (Math.abs(remaining) < 0.2) return { status: "reached" };
  if (Math.sign(remaining) !== Math.sign(slopeKgPerDay) && Math.abs(slopeKgPerDay) >= MIN_GOAL_SLOPE) {
    return { status: "wrong_direction" };
  }
  if (Math.abs(slopeKgPerDay) < MIN_GOAL_SLOPE) return { status: "too_slow" };

  const days = remaining / slopeKgPerDay;
  if (days > MAX_GOAL_DAYS) return { status: "too_slow" };

  const pace = Math.abs(slopeKgPerDay);
  const distance = Math.abs(remaining);
  const fastest = pace + slopeSe;
  const slowest = pace - slopeSe;
  const latest = slowest >= MIN_GOAL_SLOPE ? distance / slowest : null;
  return {
    status: "eta",
    days: Math.round(days),
    earliestDays: Math.round(distance / fastest),
    latestDays: latest !== null && latest <= MAX_GOAL_DAYS ? Math.round(latest) : null,
  };
}

// ------------------------------------------------------------------ data quality

export type DataQuality = {
  score: number;
  level: "low" | "medium" | "high";
  documentedDays: number;
  weighDays: number;
  /** 0 to 1: how regular the time of day of the weigh-ins is. */
  weighTimeConsistency: number;
  windowDays: number;
};

/** Weigh days in the window that count as "regular": about three a week. */
const FULL_SCORE_WEIGH_DAYS = 12;

export function dataQuality(input: {
  today: number;
  weighIns: WeighIn[];
  dayBalances: DayBalance[];
  windowDays?: number;
}): DataQuality {
  const windowDays = input.windowDays ?? WINDOW_DAYS;
  const from = input.today - windowDays;

  const documentedDays = input.dayBalances.filter((d) => d.documented && d.day > from && d.day <= input.today).length;

  const hoursByDay = new Map<number, number>();
  for (const weighIn of input.weighIns) {
    const time = new Date(weighIn.at);
    if (Number.isNaN(time.getTime())) continue;
    const day = dayIndex(time);
    if (day <= from || day > input.today || hoursByDay.has(day)) continue;
    hoursByDay.set(day, time.getHours() + time.getMinutes() / 60);
  }
  const weighDays = hoursByDay.size;

  let consistency = 0;
  if (weighDays >= 3) {
    const hours = [...hoursByDay.values()];
    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const sd = Math.sqrt(hours.reduce((sum, h) => sum + (h - mean) ** 2, 0) / hours.length);
    // Within an hour and a half counts as fully regular; four hours or more as not regular at all.
    consistency = Math.min(1, Math.max(0, (4 - sd) / 2.5));
  }

  const foodShare = Math.min(1, documentedDays / windowDays);
  const weighShare = Math.min(1, weighDays / FULL_SCORE_WEIGH_DAYS);
  const score = Math.round(100 * (0.45 * foodShare + 0.4 * weighShare + 0.15 * consistency));
  const level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";

  return { score, level, documentedDays, weighDays, weighTimeConsistency: consistency, windowDays };
}

// ------------------------------------------------------------------ measured against calculated

export type CalibrationInsight =
  | { status: "insufficient" }
  | { status: "consistent"; gapKcalPerDay: number }
  | {
      status: "gap";
      /**
       * Positive: the scale moved up more (or down less) than the calorie balance predicts,
       * by this many kcal a day. Negative: the opposite.
       */
      gapKcalPerDay: number;
    };

/**
 * Compares the measured weight trend with the change the logged calories predict.
 * A gap is reported as an observation only. It never changes targets by itself, and it does not
 * say which side is off: under-logged food is as likely as a wrong expenditure estimate.
 */
export function calibrationInsight(trend: TrendFit | null, calories: CalorieTrend | null): CalibrationInsight {
  if (
    !trend ||
    !calories ||
    trend.spanDays < MIN_CALIBRATION_SPAN_DAYS ||
    trend.weighDays < MIN_CALIBRATION_WEIGH_DAYS ||
    calories.documentedDays < MIN_CALIBRATION_DOCUMENTED_DAYS
  ) {
    return { status: "insufficient" };
  }
  const gap = (trend.slopeKgPerDay - calories.slopeKgPerDay) * KCAL_PER_KG;
  if (Math.abs(gap) < CALIBRATION_TOLERANCE_KCAL) return { status: "consistent", gapKcalPerDay: gap };
  return { status: "gap", gapKcalPerDay: gap };
}

// ------------------------------------------------------------------ applying a calibration

export const MAX_CALIBRATION_KCAL = 500;
/** Only this share of a measured gap is applied at once, so one noisy month cannot swing the estimate. */
export const CALIBRATION_STEP_SHARE = 0.5;

/**
 * The expenditure adjustment to offer for a measured gap, on top of the adjustment already in force.
 * A positive gap means the scale lags behind the calculation, so the expenditure estimate is lowered.
 * Half of the gap is applied, rounded to 10 kcal and kept within +/-500.
 * Returns null when the step would change nothing.
 */
export function suggestCalibration(gapKcalPerDay: number, currentAdjustmentKcal: number): number | null {
  if (!Number.isFinite(gapKcalPerDay) || Math.abs(gapKcalPerDay) < CALIBRATION_TOLERANCE_KCAL) return null;
  const step = Math.round((gapKcalPerDay * CALIBRATION_STEP_SHARE) / 10) * 10;
  const next = Math.max(-MAX_CALIBRATION_KCAL, Math.min(MAX_CALIBRATION_KCAL, currentAdjustmentKcal - step));
  return next === currentAdjustmentKcal ? null : next;
}

/** Baseline expenditure with the confirmed calibration applied. Never below the resting rate. */
export function calibratedBaseline(baselineKcal: number, bmr: number, adjustmentKcal: number): number {
  return Math.max(bmr, baselineKcal + adjustmentKcal);
}
