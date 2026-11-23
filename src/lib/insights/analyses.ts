// The insight analyses. Each one looks for one kind of pattern that is hard to see on any screen,
// and returns a finding only when the evidence passes its thresholds. Pure code: every number shown
// to the user (or handed to the AI editor) is computed here.

import type { InsightDataset, InsightDay } from "./dataset.ts";
import { dailyWeights, dateOfDay, fitTrend, KCAL_PER_KG } from "../weight/trend.ts";

export type InsightKind =
  | "delayed_compensation"
  | "weigh_in_conditions"
  | "small_swap"
  | "goal_reality"
  | "outlier_days"
  | "logging_blind_spots"
  | "day_tags";

export type Finding = {
  kind: InsightKind;
  /** 0..1: how strong and how useful the finding is. Used to rank. */
  strength: number;
  title: string;
  /** Plain-language text built from the numbers, used when the AI editor is not available. */
  text: string;
  /** The verified numbers behind the finding, for the AI editor. */
  facts: Record<string, string | number>;
};

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const round = (value: number, step = 1) => Math.round(value / step) * step;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const fmt = (value: number) => Math.round(value).toLocaleString("he-IL");

function loggedDays(ds: InsightDataset): InsightDay[] {
  return ds.days.filter((day) => day.logged);
}

// ------------------------------------------------------------------ 1. compensation on the days after a workout

/** A workout this big (counted active kcal) is a "big workout day". */
export const BIG_WORKOUT_KCAL = 300;

export function delayedCompensation(ds: InsightDataset): Finding | null {
  const byDay = new Map(ds.days.map((day) => [day.day, day]));
  const big = ds.days.filter((day) => day.workoutKcal >= BIG_WORKOUT_KCAL);
  const isBig = (day: number) => (byDay.get(day)?.workoutKcal ?? 0) >= BIG_WORKOUT_KCAL;

  // Ordinary days: logged, not a big workout day, and not one of the two days after one.
  const after = new Set<number>();
  for (const day of big) {
    after.add(day.day + 1);
    after.add(day.day + 2);
  }
  const ordinary = loggedDays(ds).filter((day) => !isBig(day.day) && !after.has(day.day));
  if (ordinary.length < 7) return null;
  const baseline = mean(ordinary.map((day) => day.intakeKcal));

  // Per episode: extra eaten on each of the two following days that is logged and not itself a big day.
  const episodes: { extra: number; burned: number }[] = [];
  for (const workout of big) {
    const following = [workout.day + 1, workout.day + 2]
      .map((day) => byDay.get(day))
      .filter((day): day is InsightDay => day !== undefined && day.logged && !isBig(day.day));
    if (following.length === 0) continue;
    // Scaled to two days, so an episode with one logged day weighs the same as one with two.
    const extra = (mean(following.map((day) => day.intakeKcal - baseline)) * 2);
    episodes.push({ extra, burned: workout.workoutKcal });
  }
  if (episodes.length < 3) return null;

  const extraAfter = mean(episodes.map((episode) => episode.extra));
  const avgWorkout = mean(episodes.map((episode) => episode.burned));
  const ratio = extraAfter / avgWorkout;
  if (extraAfter < 200 || ratio < 0.25) return null;

  const loggedBig = big.filter((day) => day.logged);
  const sameDayExtra = loggedBig.length > 0 ? mean(loggedBig.map((day) => day.intakeKcal)) - baseline : 0;
  const percent = round(ratio * 100, 5);

  return {
    kind: "delayed_compensation",
    strength: Math.min(1, ratio),
    title: "האימון מתקזז ביומיים שאחריו",
    text:
      (Math.abs(sameDayExtra) < 150
        ? `ביום של אימון גדול (בממוצע ${fmt(avgWorkout)} קק"ל) האכילה כמעט לא משתנה, אבל `
        : `אחרי אימון גדול (בממוצע ${fmt(avgWorkout)} קק"ל), מעבר למה שקורה ביום עצמו, `) +
      `ביומיים שאחריו נאכלים בממוצע ${fmt(extraAfter)} קק"ל יותר מבימים רגילים: כ-${percent}% ממה שנשרף. ` +
      `זה קשה לראות, כי התוספת מתפזרת על יומיים.`,
    facts: {
      workouts_analyzed: episodes.length,
      avg_workout_active_kcal: round(avgWorkout),
      extra_kcal_over_next_two_days: round(extraAfter),
      share_of_workout_eaten_back_percent: percent,
      same_day_extra_kcal: round(sameDayExtra),
      ordinary_day_intake_kcal: round(baseline),
    },
  };
}

// ------------------------------------------------------------------ 2. weigh-in conditions and the real trend

/** Least squares for a small dense system (normal equations). Null when singular. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** weight = a + b*day + offset(condition). Returns the slope and each condition's offset from the reference. */
export function fitWithConditionOffsets(
  points: { day: number; weightKg: number; condition: string }[],
  reference: string,
): { slopeKgPerDay: number; offsets: Map<string, number> } | null {
  const others = [...new Set(points.map((point) => point.condition))].filter((condition) => condition !== reference);
  const size = 2 + others.length;
  const xtx = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const xty = new Array<number>(size).fill(0);
  const day0 = points[0]?.day ?? 0;
  for (const point of points) {
    const row = [1, point.day - day0, ...others.map((condition) => (condition === point.condition ? 1 : 0))];
    for (let i = 0; i < size; i += 1) {
      xty[i] += row[i] * point.weightKg;
      for (let j = 0; j < size; j += 1) xtx[i][j] += row[i] * row[j];
    }
  }
  const beta = solve(xtx, xty);
  if (!beta) return null;
  return { slopeKgPerDay: beta[1], offsets: new Map(others.map((condition, i) => [condition, beta[2 + i]])) };
}

function plainSlope(points: { day: number; weightKg: number }[]): number | null {
  if (points.length < 3) return null;
  const mx = mean(points.map((point) => point.day));
  const my = mean(points.map((point) => point.weightKg));
  let sxx = 0;
  let sxy = 0;
  for (const point of points) {
    sxx += (point.day - mx) ** 2;
    sxy += (point.day - mx) * (point.weightKg - my);
  }
  return sxx === 0 ? null : sxy / sxx;
}

export function weighInConditions(ds: InsightDataset): Finding | null {
  const points = ds.weighIns
    .filter((weighIn) => weighIn.condition !== null && weighIn.condition !== "אחר")
    .map((weighIn) => ({ day: weighIn.day, weightKg: weighIn.weightKg, condition: weighIn.condition as string }));
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.condition, (counts.get(point.condition) ?? 0) + 1);
  const used = [...counts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]);
  if (used.length < 2) return null;
  const kept = points.filter((point) => used.some(([condition]) => condition === point.condition));
  if (kept.length < 8) return null;
  const span = Math.max(...kept.map((point) => point.day)) - Math.min(...kept.map((point) => point.day));
  if (span < 14) return null;

  const reference = used[0][0];
  const fit = fitWithConditionOffsets(kept, reference);
  if (!fit) return null;
  const naive = plainSlope(kept);
  if (naive === null) return null;

  let biggest: [string, number] | null = null;
  for (const [condition, offset] of fit.offsets) if (!biggest || Math.abs(offset) > Math.abs(biggest[1])) biggest = [condition, offset];
  if (!biggest || Math.abs(biggest[1]) < 0.4) return null;

  const realWeekly = fit.slopeKgPerDay * 7;
  const naiveWeekly = naive * 7;
  const distorted = Math.abs(realWeekly - naiveWeekly) >= 0.15;
  const direction = (weekly: number) =>
    Math.abs(weekly) < 0.05 ? "יציב" : `${weekly < 0 ? "ירידה" : "עלייה"} של ${Math.abs(weekly).toFixed(2)} ק"ג בשבוע`;

  return {
    kind: "weigh_in_conditions",
    strength: Math.min(1, Math.abs(biggest[1]) / 1.0 + (distorted ? 0.2 : 0)),
    title: "סוג השקילה משנה את התמונה",
    text:
      `שקילות "${biggest[0]}" יוצאות ${Math.abs(biggest[1]).toFixed(1)} ק"ג ${biggest[1] < 0 ? "נמוכות" : "גבוהות"} ` +
      `משקילות "${reference}", גם כשמנטרלים את המגמה. ` +
      (distorted
        ? `כשמערבבים ביניהן המגמה נראית ${direction(naiveWeekly)}, אבל המגמה האמיתית היא ${direction(realWeekly)}.`
        : `המגמה האמיתית, כשמשווים רק סוג שקילה לאותו סוג: ${direction(realWeekly)}.`),
    facts: {
      reference_condition: reference,
      other_condition: biggest[0],
      offset_kg: Number(biggest[1].toFixed(2)),
      real_trend_kg_per_week: Number(realWeekly.toFixed(2)),
      mixed_trend_kg_per_week: Number(naiveWeekly.toFixed(2)),
      mixing_distorts_trend: distorted ? "yes" : "no",
      weigh_ins_analyzed: kept.length,
    },
  };
}

// ------------------------------------------------------------------ 3. one small change with a big effect

export function smallSwap(ds: InsightDataset): Finding | null {
  const logged = loggedDays(ds);
  if (logged.length < 14) return null;
  const totalIntake = logged.reduce((sum, day) => sum + day.intakeKcal, 0);
  if (totalIntake <= 0) return null;

  const recurring = ds.items.filter((item) => item.days >= 6);
  if (recurring.length === 0) return null;
  const top = recurring[0];
  const share = top.totalKcal / totalIntake;
  const perDay = top.totalKcal / logged.length;
  // Cutting this one item by a quarter, kept up for half a year.
  const savedPerDay = perDay * 0.25;
  const kgHalfYear = (savedPerDay * 182) / KCAL_PER_KG;
  if (share < 0.06 || kgHalfYear < 1) return null;

  const topThree = recurring.slice(0, 3);
  const topThreeShare = topThree.reduce((sum, item) => sum + item.totalKcal, 0) / totalIntake;

  return {
    kind: "small_swap",
    strength: Math.min(1, kgHalfYear / 3),
    title: `שינוי קטן ב"${top.name}"`,
    text:
      `"${top.name}" מופיע ב-${top.days} ימים ומהווה ${round(share * 100)}% מכל הקלוריות שלך, ` +
      `בממוצע ${fmt(perDay)} קק"ל ביום. להקטין אותו ברבע, או להחליף בגרסה קלה יותר, שווה כ-${kgHalfYear.toFixed(1)} ק"ג בחצי שנה, ` +
      `בלי לוותר על שום ארוחה.`,
    facts: {
      item: top.name,
      days_with_item: top.days,
      logged_days: logged.length,
      item_share_of_calories_percent: round(share * 100),
      item_kcal_per_day: round(perDay),
      saving_if_reduced_by_quarter_kcal_per_day: round(savedPerDay),
      kg_in_half_year_if_reduced_by_quarter: Number(kgHalfYear.toFixed(1)),
      top_three_items: topThree.map((item) => item.name).join(", "),
      top_three_share_percent: round(topThreeShare * 100),
    },
  };
}

// ------------------------------------------------------------------ 4. the real pace against the plan

function shortDate(day: number): string {
  const date = dateOfDay(day);
  return `${date.getDate()}.${date.getMonth() + 1}.${String(date.getFullYear()).slice(2)}`;
}

function dayOfIsoDate(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

export function goalReality(ds: InsightDataset): Finding | null {
  const daily = dailyWeights(ds.weighIns.map((weighIn) => ({ at: dateOfDay(weighIn.day).toISOString(), weightKg: weighIn.weightKg })));
  const fit = fitTrend(daily, ds.lastDay);
  if (!fit || fit.weighDays < 8 || fit.spanDays < 21) return null;

  const actualWeekly = fit.slopeKgPerDay * 7;
  const planned = ds.plan.plannedWeeklyKg;
  // Positive gap: progress is slower than planned (for loss) by this many kcal a day.
  const gapKcal = ((actualWeekly - planned) * KCAL_PER_KG) / 7;
  if (Math.abs(gapKcal) < 150) return null;

  const facts: Record<string, string | number> = {
    actual_trend_kg_per_week: Number(actualWeekly.toFixed(2)),
    planned_kg_per_week: Number(planned.toFixed(2)),
    gap_kcal_per_day: round(gapKcal),
    trend_weight_now_kg: Number(fit.valueAtEnd.toFixed(1)),
  };

  let etaText = "";
  const target = ds.plan.targetWeightKg;
  if (target !== null) {
    const toGo = target - fit.valueAtEnd;
    if (Math.abs(toGo) >= 0.3 && Math.sign(toGo) === Math.sign(fit.slopeKgPerDay) && Math.abs(fit.slopeKgPerDay) > 0.005) {
      const etaDay = ds.lastDay + Math.round(toGo / fit.slopeKgPerDay);
      facts.target_weight_kg = target;
      facts.eta_at_actual_pace = shortDate(etaDay);
      etaText = ` בקצב הזה תגיע ל-${target} ק"ג בערך ב-${shortDate(etaDay)}`;
      const targetDay = ds.plan.targetDate ? dayOfIsoDate(ds.plan.targetDate) : null;
      if (targetDay !== null) {
        const weeks = Math.round((etaDay - targetDay) / 7);
        facts.target_date = shortDate(targetDay);
        facts.weeks_late_vs_target_date = weeks;
        if (weeks !== 0) etaText += `, ${Math.abs(weeks)} שבועות ${weeks > 0 ? "אחרי" : "לפני"} התאריך שקבעת`;
      }
      etaText += ".";
    }
  }

  const slower = planned < 0 ? gapKcal > 0 : gapKcal < 0;
  return {
    kind: "goal_reality",
    strength: Math.min(1, Math.abs(gapKcal) / 400),
    title: slower ? "הקצב בפועל איטי מהתוכנית" : "הקצב בפועל מהיר מהתוכנית",
    text:
      `לפי השקילות, הקצב בפועל הוא ${Math.abs(actualWeekly).toFixed(2)} ק"ג בשבוע ` +
      `${actualWeekly < 0 ? "ירידה" : "עלייה"}, לעומת ${Math.abs(planned).toFixed(2)} בתוכנית. ` +
      `הפער שווה בערך ${fmt(Math.abs(gapKcal))} קק"ל ביום.${etaText}`,
    facts,
  };
}

// ------------------------------------------------------------------ 5. a few days that spoil the week

export const SPIKE_KCAL = 500;

export function outlierDays(ds: InsightDataset): Finding | null {
  const logged = loggedDays(ds);
  if (logged.length < 10) return null;
  const target = ds.plan.targetKcal;
  // A day's allowance includes the workout it had.
  const excess = (day: InsightDay) => day.intakeKcal - (target + day.workoutKcal);
  const spikes = logged.filter((day) => excess(day) >= SPIKE_KCAL);
  if (spikes.length < 3 || spikes.length / logged.length > 0.35) return null;

  const positive = logged.reduce((sum, day) => sum + Math.max(0, excess(day)), 0);
  const spikeExcess = spikes.reduce((sum, day) => sum + excess(day), 0);
  if (positive <= 0) return null;
  const share = spikeExcess / positive;
  if (share < 0.5) return null;

  const others = logged.filter((day) => excess(day) < SPIKE_KCAL);
  const othersDelta = others.length > 0 ? mean(others.map(excess)) : 0;
  const weeks = Math.max(1, (ds.lastDay - ds.firstDay + 1) / 7);
  const kgPerMonth = ((spikeExcess / weeks) * 4.3) / KCAL_PER_KG;

  const weekdayCounts = new Array<number>(7).fill(0);
  for (const day of spikes) weekdayCounts[day.weekday] += 1;
  const topWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const weekdayNote =
    weekdayCounts[topWeekday] >= 2 && weekdayCounts[topWeekday] / spikes.length >= 0.4
      ? ` הרבה מהם בימי ${WEEKDAYS[topWeekday]}.`
      : "";

  return {
    kind: "outlier_days",
    strength: Math.min(1, share * (spikes.length >= 4 ? 1 : 0.85)),
    title: "כמה ימים בודדים מקלקלים את השבוע",
    text:
      `ברוב הימים אתה ${othersDelta <= 0 ? `מתחת ליעד בכ-${fmt(-othersDelta)}` : `מעל היעד בכ-${fmt(othersDelta)}`} קק"ל. ` +
      `אבל ${spikes.length} ימים מתוך ${logged.length} חרגו ביותר מ-${SPIKE_KCAL}, והם אחראים ל-${round(share * 100)}% מכל החריגות.` +
      weekdayNote +
      ` לטפל רק בהם שווה כ-${kgPerMonth.toFixed(1)} ק"ג בחודש.`,
    facts: {
      logged_days: logged.length,
      spike_days: spikes.length,
      avg_spike_excess_kcal: round(spikeExcess / spikes.length),
      spikes_share_of_all_excess_percent: round(share * 100),
      other_days_vs_target_kcal: round(othersDelta),
      common_spike_weekday: weekdayNote ? WEEKDAYS[topWeekday] : "none",
      kg_per_month_if_spikes_were_on_target: Number(kgPerMonth.toFixed(1)),
    },
  };
}

// ------------------------------------------------------------------ 6. what the scale says was not logged

export function loggingBlindSpots(ds: InsightDataset): Finding | null {
  const logged = loggedDays(ds);
  if (logged.length < 14) return null;
  const daily = dailyWeights(ds.weighIns.map((weighIn) => ({ at: dateOfDay(weighIn.day).toISOString(), weightKg: weighIn.weightKg })));
  const fit = fitTrend(daily, ds.lastDay);
  if (!fit || fit.weighDays < 8 || fit.spanDays < 21) return null;

  // Balance the log implies, against the change the scale shows.
  const loggedBalance = mean(logged.map((day) => day.intakeKcal - (ds.plan.baselineKcal + day.workoutKcal)));
  const measuredBalance = fit.slopeKgPerDay * KCAL_PER_KG;
  const unlogged = measuredBalance - loggedBalance;
  if (unlogged < 200) return null;

  const partial = logged.filter((day) => day.entries <= 1).length;
  const partialShare = partial / logged.length;

  return {
    kind: "logging_blind_spots",
    strength: Math.min(1, unlogged / 500),
    title: "המשקל מספר על אוכל שלא נרשם",
    text:
      `לפי מה שנרשם, היית אמור ${loggedBalance < 0 ? "לרדת" : "לעלות"} בקצב של ${Math.abs((loggedBalance * 7) / KCAL_PER_KG).toFixed(2)} ק"ג בשבוע, ` +
      `אבל המשקל ${fit.slopeKgPerDay < 0 ? "יורד" : "עולה"} בקצב של ${Math.abs(fit.slopeKgPerDay * 7).toFixed(2)}. ` +
      `הפער שווה כ-${fmt(unlogged)} קק"ל ביום שלא נכנסים לרישום.` +
      (partialShare >= 0.15 ? ` ב-${round(partialShare * 100)}% מהימים נרשמה רק ארוחה אחת.` : ""),
    facts: {
      logged_days: logged.length,
      balance_from_log_kcal_per_day: round(loggedBalance),
      balance_from_scale_kcal_per_day: round(measuredBalance),
      unlogged_kcal_per_day: round(unlogged),
      days_with_one_entry_percent: round(partialShare * 100),
    },
  };
}

// ------------------------------------------------------------------ 7. what a tagged day does

/** The tag whose days change intake the most, on the day itself and the day after. */
export function dayTags(ds: InsightDataset): Finding | null {
  const byDay = new Map(ds.days.map((day) => [day.day, day]));
  const names = [...new Set(ds.days.flatMap((day) => day.tags))];
  const weeks = Math.max(1, (ds.lastDay - ds.firstDay + 1) / 7);
  let best: Finding | null = null;

  for (const name of names) {
    const marked = ds.days.filter((day) => day.logged && day.tags.includes(name));
    if (marked.length < 3) continue;
    const markedDays = new Set(ds.days.filter((day) => day.tags.includes(name)).map((day) => day.day));
    // Ordinary days: logged, no tag at all, and not the day after this tag.
    const ordinary = ds.days.filter(
      (day) => day.logged && day.tags.length === 0 && !markedDays.has(day.day - 1),
    );
    if (ordinary.length < 7) continue;
    const base = mean(ordinary.map((day) => day.intakeKcal));
    const sameDay = mean(marked.map((day) => day.intakeKcal)) - base;
    const after = [...markedDays]
      .map((day) => byDay.get(day + 1))
      .filter((day): day is InsightDay => day !== undefined && day.logged && !day.tags.includes(name));
    const nextDay = after.length >= 2 ? mean(after.map((day) => day.intakeKcal)) - base : 0;
    const strongest = Math.max(Math.abs(sameDay), Math.abs(nextDay));
    if (strongest < 300) continue;

    const perMonth = (markedDays.size / weeks) * 4.3;
    const kgPerMonth = ((sameDay + nextDay) * perMonth) / KCAL_PER_KG;
    const more = (kcal: number) => `${fmt(Math.abs(kcal))} קק"ל ${kcal >= 0 ? "יותר" : "פחות"}`;
    const finding: Finding = {
      kind: "day_tags",
      strength: Math.min(1, strongest / 900),
      title: `מה קורה בימים עם "${name}"`,
      text:
        `בימים עם "${name}" נאכלים בממוצע ${more(sameDay)} מבימים רגילים` +
        (Math.abs(nextDay) >= 150 ? `, וביום שאחרי עוד ${more(nextDay)}` : "") +
        `. זה קורה בערך ${perMonth.toFixed(1)} פעמים בחודש` +
        (Math.abs(kgPerMonth) >= 0.1 ? `, ושווה כ-${Math.abs(kgPerMonth).toFixed(1)} ק"ג בחודש.` : "."),
      facts: {
        tag: name,
        tagged_days: markedDays.size,
        extra_kcal_same_day: round(sameDay),
        extra_kcal_next_day: round(nextDay),
        ordinary_day_intake_kcal: round(base),
        times_per_month: Number(perMonth.toFixed(1)),
        kg_per_month: Number(kgPerMonth.toFixed(2)),
      },
    };
    if (!best || finding.strength > best.strength) best = finding;
  }
  return best;
}

// ------------------------------------------------------------------ all together

const ANALYSES = [
  delayedCompensation,
  weighInConditions,
  smallSwap,
  goalReality,
  outlierDays,
  loggingBlindSpots,
  dayTags,
];

/** Every finding that passed its thresholds, strongest first. */
export function runAnalyses(ds: InsightDataset): Finding[] {
  const findings: Finding[] = [];
  for (const analysis of ANALYSES) {
    try {
      const finding = analysis(ds);
      if (finding) findings.push(finding);
    } catch {
      // One analysis failing must not hide the others.
    }
  }
  return findings.sort((a, b) => b.strength - a.strength);
}
