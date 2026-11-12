import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrationInsight,
  calorieTrend,
  dailyWeights,
  dataQuality,
  dateOfDay,
  dayIndex,
  fitTrend,
  forecastWeight,
  goalEta,
  monthToDate,
  movingAverage,
  type DayBalance,
  type WeighIn,
} from "./trend.ts";

// Synthetic data only.

const TODAY = dayIndex(new Date(2026, 10, 12));

function near(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function weighInOn(day: number, weightKg: number, hour = 7, minute = 0): WeighIn {
  const date = dateOfDay(day);
  date.setHours(hour, minute);
  return { at: date.toISOString(), weightKg };
}

/** One weigh-in every `step` days ending today, falling by `perDay` kg a day. */
function fallingSeries(days: number, perDay: number, step = 1, startKg = 85): WeighIn[] {
  const series: WeighIn[] = [];
  for (let back = days - 1; back >= 0; back -= step) {
    series.push(weighInOn(TODAY - back, startKg - perDay * (days - 1 - back)));
  }
  return series;
}

function balances(count: number, kcal: number, documented = true): DayBalance[] {
  return Array.from({ length: count }, (_, i) => ({ day: TODAY - i, balanceKcal: kcal, documented }));
}

// ------------------------------------------------------------------ days

test("day numbers are consecutive across month, year and daylight-saving changes", () => {
  assert.equal(dayIndex(new Date(2026, 11, 1)) - dayIndex(new Date(2026, 10, 30)), 1);
  assert.equal(dayIndex(new Date(2027, 0, 1)) - dayIndex(new Date(2026, 11, 31)), 1);
  assert.equal(dayIndex(new Date(2026, 2, 29, 23, 30)) - dayIndex(new Date(2026, 2, 27, 0, 30)), 2);
  assert.equal(dayIndex(new Date(2026, 10, 12, 0, 1)), dayIndex(new Date(2026, 10, 12, 23, 59)));
});

test("a day number converts back to the same local date", () => {
  const date = dateOfDay(TODAY);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 12);
  assert.equal(date.getHours(), 0);
});

// ------------------------------------------------------------------ weigh-ins

test("several weigh-ins on one day are averaged, and days are sorted", () => {
  const daily = dailyWeights([
    weighInOn(TODAY, 81, 7),
    weighInOn(TODAY - 2, 82),
    weighInOn(TODAY, 82, 21),
    { at: "not a date", weightKg: 80 },
  ]);
  assert.deepEqual(daily, [
    { day: TODAY - 2, weightKg: 82, count: 1 },
    { day: TODAY, weightKg: 81.5, count: 2 },
  ]);
});

test("moving average covers the trailing seven days only", () => {
  const daily = dailyWeights([
    weighInOn(TODAY - 10, 90),
    weighInOn(TODAY - 6, 84),
    weighInOn(TODAY - 3, 83),
    weighInOn(TODAY, 82),
  ]);
  const average = movingAverage(daily);
  assert.equal(average[0].value, 90);
  near(average[1].value, 87); // 90 and 84: four days apart
  near(average[2].value, 83.5); // 84 and 83: the 90 is now eight days back
  near(average[3].value, 83); // 84, 83, 82
});

// ------------------------------------------------------------------ trend

test("a steady fall is fitted exactly", () => {
  const trend = fitTrend(dailyWeights(fallingSeries(28, 0.1)), TODAY);
  assert.ok(trend);
  near(trend.slopeKgPerDay, -0.1);
  near(trend.valueAtEnd, 85 - 0.1 * 27);
  near(trend.residualSd, 0);
  assert.equal(trend.weighDays, 28);
  assert.equal(trend.spanDays, 27);
});

test("no trend from too few weigh days or too short a span", () => {
  assert.equal(fitTrend(dailyWeights(fallingSeries(4, 0.1)), TODAY), null);
  assert.equal(fitTrend(dailyWeights(fallingSeries(8, 0.1)), TODAY), null); // 8 days in a row: span 7
  assert.equal(fitTrend(dailyWeights([weighInOn(TODAY, 82)]), TODAY), null);
  assert.equal(fitTrend([], TODAY), null);
});

test("weigh-ins older than the window are ignored", () => {
  const old = fallingSeries(28, 0.1).map((w, i) => weighInOn(TODAY - 60 - i, w.weightKg));
  assert.equal(fitTrend(dailyWeights(old), TODAY), null);
});

test("noisy weights give a slope near the truth and a non-zero spread", () => {
  const noise = [0.4, -0.3, 0.2, -0.5, 0.1, 0.3, -0.2];
  const series = fallingSeries(28, 0.1).map((w, i) => ({ ...w, weightKg: w.weightKg + noise[i % noise.length] }));
  const trend = fitTrend(dailyWeights(series), TODAY);
  assert.ok(trend);
  near(trend.slopeKgPerDay, -0.1, 0.02);
  assert.ok(trend.residualSd > 0.1);
  assert.ok(trend.slopeSe > 0);
});

// ------------------------------------------------------------------ calories

test("calorie trend averages documented days only", () => {
  const days = [...balances(10, -500), ...balances(5, -3000, false).map((d, i) => ({ ...d, day: TODAY - 10 - i }))];
  const trend = calorieTrend(days, TODAY);
  assert.ok(trend);
  assert.equal(trend.averageBalanceKcal, -500);
  assert.equal(trend.documentedDays, 10);
  near(trend.slopeKgPerDay, -500 / 7700);
});

test("no calorie trend from fewer than a week of documented days", () => {
  assert.equal(calorieTrend(balances(6, -500), TODAY), null);
  assert.equal(calorieTrend(balances(20, -500, false), TODAY), null);
});

test("month to date sums documented days from the first of the month", () => {
  const monthStart = dayIndex(new Date(2026, 10, 1));
  const days: DayBalance[] = [
    { day: monthStart - 1, balanceKcal: -900, documented: true },
    { day: monthStart, balanceKcal: -700, documented: true },
    { day: monthStart + 1, balanceKcal: -2400, documented: false },
    { day: TODAY, balanceKcal: -840, documented: true },
  ];
  const result = monthToDate(days, monthStart, TODAY);
  assert.equal(result.cumulativeBalanceKcal, -1540);
  assert.equal(result.documentedDays, 2);
  assert.equal(result.averageBalanceKcal, -770);
  near(result.theoreticalChangeKg, -0.2);
  assert.equal(result.elapsedDays, 12);
});

test("month to date with nothing documented has no average", () => {
  const result = monthToDate([], dayIndex(new Date(2026, 10, 1)), TODAY);
  assert.equal(result.averageBalanceKcal, null);
  assert.equal(result.theoreticalChangeKg, 0);
});

// ------------------------------------------------------------------ forecast

test("forecast without enough data returns nothing rather than a guess", () => {
  const forecast = forecastWeight({ today: TODAY, targetDay: TODAY + 30, currentWeightKg: 82, trend: null, calories: null });
  assert.equal(forecast.daysAhead, 30);
  assert.equal(forecast.theoretical, null);
  assert.equal(forecast.trend, null);
  assert.equal(forecast.combined, null);
});

test("theoretical forecast follows the average balance and carries a range", () => {
  const calories = calorieTrend(balances(14, -770), TODAY);
  const forecast = forecastWeight({ today: TODAY, targetDay: TODAY + 30, currentWeightKg: 82, trend: null, calories });
  assert.ok(forecast.theoretical);
  near(forecast.theoretical.weightKg, 79); // 30 days * -0.1 kg
  assert.ok(forecast.theoretical.lowKg < 79 && forecast.theoretical.highKg > 79);
  near(forecast.theoretical.highKg - forecast.theoretical.weightKg, 0.5 + 3 * 0.35);
  assert.equal(forecast.combined, null);
});

test("trend forecast continues the fitted line, and the range widens with distance", () => {
  const noise = [0.4, -0.3, 0.2, -0.5, 0.1, 0.3, -0.2];
  const series = fallingSeries(28, 0.1).map((w, i) => ({ ...w, weightKg: w.weightKg + noise[i % noise.length] }));
  const trend = fitTrend(dailyWeights(series), TODAY);
  assert.ok(trend);
  const near30 = forecastWeight({ today: TODAY, targetDay: TODAY + 30, currentWeightKg: null, trend, calories: null });
  const near90 = forecastWeight({ today: TODAY, targetDay: TODAY + 90, currentWeightKg: null, trend, calories: null });
  assert.ok(near30.trend && near90.trend);
  near(near30.trend.weightKg, trend.valueAtEnd + trend.slopeKgPerDay * 30);
  assert.ok(near90.trend.highKg - near90.trend.lowKg > near30.trend.highKg - near30.trend.lowKg);
});

test("combined forecast sits between the two and widens when they disagree", () => {
  const trend = fitTrend(dailyWeights(fallingSeries(28, 0.05)), TODAY);
  const calories = calorieTrend(balances(20, -770), TODAY); // predicts -0.1 kg a day
  assert.ok(trend && calories);
  const forecast = forecastWeight({ today: TODAY, targetDay: TODAY + 40, currentWeightKg: null, trend, calories });
  assert.ok(forecast.combined && forecast.trend && forecast.theoretical);
  // 0.6 * -0.05 + 0.4 * -0.1 = -0.07 kg a day
  near(forecast.combined.weightKg, trend.valueAtEnd - 0.07 * 40);
  assert.ok(forecast.combined.weightKg < forecast.trend.weightKg);
  assert.ok(forecast.combined.weightKg > forecast.theoretical.weightKg);
  // disagreement of 0.05 kg a day over 40 days is 2 kg: half of it plus the 0.4 floor
  near(forecast.combined.highKg - forecast.combined.weightKg, 1.4);
});

test("a target date in the past is treated as today", () => {
  const calories = calorieTrend(balances(14, -770), TODAY);
  const forecast = forecastWeight({ today: TODAY, targetDay: TODAY - 5, currentWeightKg: 82, trend: null, calories });
  assert.equal(forecast.daysAhead, 0);
  assert.equal(forecast.theoretical?.weightKg, 82);
});

// ------------------------------------------------------------------ goal

test("time to goal at a steady pace, with a range", () => {
  const eta = goalEta(82, 76, -0.1, 0.02);
  assert.deepEqual(eta, { status: "eta", days: 60, earliestDays: 50, latestDays: 75 });
});

test("goal states: reached, moving away, too slow, no upper bound", () => {
  assert.deepEqual(goalEta(76.1, 76, -0.1, 0.01), { status: "reached" });
  assert.deepEqual(goalEta(82, 76, 0.05, 0.01), { status: "wrong_direction" });
  assert.deepEqual(goalEta(82, 76, -0.001, 0.01), { status: "too_slow" });
  assert.deepEqual(goalEta(82, 60, -0.02, 0.001), { status: "too_slow" }); // 1100 days
  const uncertain = goalEta(82, 76, -0.05, 0.048);
  assert.equal(uncertain.status, "eta");
  if (uncertain.status === "eta") assert.equal(uncertain.latestDays, null);
});

test("goal works for gaining weight too", () => {
  const eta = goalEta(60, 63, 0.05, 0);
  assert.deepEqual(eta, { status: "eta", days: 60, earliestDays: 60, latestDays: 60 });
});

// ------------------------------------------------------------------ data quality

test("full, regular logging scores high", () => {
  const quality = dataQuality({
    today: TODAY,
    weighIns: fallingSeries(28, 0.1, 2),
    dayBalances: balances(28, -500),
  });
  assert.equal(quality.documentedDays, 28);
  assert.equal(quality.weighDays, 14);
  assert.equal(quality.weighTimeConsistency, 1);
  assert.equal(quality.score, 100);
  assert.equal(quality.level, "high");
});

test("no data scores zero and low", () => {
  const quality = dataQuality({ today: TODAY, weighIns: [], dayBalances: [] });
  assert.equal(quality.score, 0);
  assert.equal(quality.level, "low");
});

test("partial logging and irregular weigh times lower the score", () => {
  const hours = [6, 22, 13, 7, 20, 9];
  const weighIns = hours.map((hour, i) => weighInOn(TODAY - i * 4, 82, hour));
  const quality = dataQuality({ today: TODAY, weighIns, dayBalances: balances(14, -500) });
  assert.equal(quality.documentedDays, 14);
  assert.equal(quality.weighDays, 6);
  assert.equal(quality.weighTimeConsistency, 0);
  // 0.45 * 14/28 + 0.4 * 6/12 = 0.425
  assert.equal(quality.score, 43);
  assert.equal(quality.level, "medium");
});

test("undocumented days and old records do not count toward quality", () => {
  const quality = dataQuality({
    today: TODAY,
    weighIns: [weighInOn(TODAY - 40, 85)],
    dayBalances: [...balances(5, -500, false), { day: TODAY - 40, balanceKcal: -500, documented: true }],
  });
  assert.equal(quality.documentedDays, 0);
  assert.equal(quality.weighDays, 0);
});

// ------------------------------------------------------------------ calibration insight

test("no comparison is made on thin data", () => {
  const shortTrend = fitTrend(dailyWeights(fallingSeries(14, 0.1)), TODAY);
  const calories = calorieTrend(balances(20, -770), TODAY);
  assert.ok(shortTrend && calories);
  assert.deepEqual(calibrationInsight(shortTrend, calories), { status: "insufficient" });
  assert.deepEqual(calibrationInsight(null, calories), { status: "insufficient" });

  const trend = fitTrend(dailyWeights(fallingSeries(28, 0.1)), TODAY);
  const fewDays = calorieTrend(balances(10, -770), TODAY);
  assert.deepEqual(calibrationInsight(trend, fewDays), { status: "insufficient" });

  const sparse = fitTrend(dailyWeights(fallingSeries(28, 0.1, 5)), TODAY); // six weigh days
  assert.ok(sparse);
  assert.deepEqual(calibrationInsight(sparse, calories), { status: "insufficient" });
});

test("measured and calculated change that agree are reported as consistent", () => {
  const trend = fitTrend(dailyWeights(fallingSeries(28, 0.1)), TODAY);
  const calories = calorieTrend(balances(20, -770), TODAY);
  const insight = calibrationInsight(trend, calories);
  assert.equal(insight.status, "consistent");
});

test("a lasting gap is reported in kcal a day, with its direction", () => {
  // The scale falls 0.05 kg a day while the log predicts 0.1: 385 kcal a day unexplained.
  const trend = fitTrend(dailyWeights(fallingSeries(28, 0.05)), TODAY);
  const calories = calorieTrend(balances(20, -770), TODAY);
  const insight = calibrationInsight(trend, calories);
  assert.equal(insight.status, "gap");
  if (insight.status === "gap") near(insight.gapKcalPerDay, 385, 1e-6);

  const faster = calibrationInsight(fitTrend(dailyWeights(fallingSeries(28, 0.15)), TODAY), calories);
  assert.equal(faster.status, "gap");
  if (faster.status === "gap") near(faster.gapKcalPerDay, -385, 1e-6);
});
