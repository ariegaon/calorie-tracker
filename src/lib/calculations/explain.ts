// "How did we calculate this?": the user's own numbers, step by step, in plain Hebrew.
// Pure, relative imports only, so it runs under `node --test`. The numbers come from the same
// functions the screens use, so the explanation always matches what is shown.

import { KCAL_PER_KG, MIN_CALORIE_TARGET, type CalorieTarget, type Sex } from "./energy.ts";
import type { MacroTargets } from "./macros.ts";

export type ExplainInput = {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  /** Where the weight came from: the latest weigh-in, or the profile when there is none. */
  weightSource: "weigh_in" | "profile";
  activityFactor: number;
  activityLabel: string;
  bmr: number;
  formulaBaseline: number;
  adjustmentKcal: number;
  baseline: number;
  weeklyGoalKg: number;
  /** Set when the pace comes from a target date. */
  byDate: { targetDate: string; capped: boolean; reached: boolean } | null;
  target: CalorieTarget;
  /** The day being shown; null on the profile screen. */
  day: { isToday: boolean; foodKcal: number; drinkKcal: number; snackKcal: number; workoutKcal: number } | null;
  macros: MacroTargets | null;
};

export type ExplainStep = {
  title: string;
  /** Plain sentences; the arithmetic is written out in them. */
  lines: string[];
  /** The step's result, shown in bold. */
  result: string | null;
};

export function fmt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function kg(value: number): string {
  const abs = Math.abs(value);
  return Number.isInteger(abs) ? String(abs) : String(Math.round(abs * 100) / 100);
}

function shortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.${year}`;
}

/** The daily target a different weekly pace would give, with the same floor. */
export function targetForPace(baseline: number, weeklyKg: number, sex: Sex): number {
  return Math.max(MIN_CALORIE_TARGET[sex], baseline + (weeklyKg * KCAL_PER_KG) / 7);
}

export function explainCalculation(input: ExplainInput): ExplainStep[] {
  const steps: ExplainStep[] = [];
  const female = input.sex === "female";
  const sexWord = female ? "אישה" : "גבר";
  const weightKg = Math.round(input.weightKg * 10) / 10;

  // 1. Resting rate.
  steps.push({
    title: "1. כמה הגוף שורף במנוחה",
    lines: [
      "זה מה שהגוף צורך ביום בלי לזוז בכלל: נשימה, לב, חום גוף. מחושב בנוסחה המקובלת (Mifflin-St Jeor) לפי מין, גיל, גובה ומשקל.",
      `${sexWord}, ${input.ageYears}, ${fmt(input.heightCm)} ס"מ, ${weightKg} ק"ג` +
        (input.weightSource === "weigh_in" ? " (מהשקילה האחרונה)" : " (מהפרופיל)") + ":",
      `10×${weightKg} + 6.25×${fmt(input.heightCm)} − 5×${input.ageYears} ${female ? "− 161" : "+ 5"}`,
    ],
    result: `${fmt(input.bmr)} קק"ל ביום`,
  });

  // 2. Everyday activity.
  steps.push({
    title: "2. הוצאה בסיסית ביום רגיל",
    lines: [
      `מוסיפים את התנועה הרגילה של היום (הליכה, עבודה, סידורים) לפי רמת הפעילות שבחרת: ${input.activityLabel}.`,
      `${fmt(input.bmr)} × ${input.activityFactor}`,
      "אימונים לא כלולים כאן: הם נספרים בנפרד ביום שבו עשית אותם.",
    ],
    result: `${fmt(input.formulaBaseline)} קק"ל ביום`,
  });

  // 3. Calibration, when one was confirmed.
  if (Math.round(input.adjustmentKcal) !== 0) {
    const up = input.adjustmentKcal > 0;
    steps.push({
      title: "3. תיקון לפי הנתונים שלך",
      lines: [
        `לפי השקילות והרישום שלך לאורך זמן, הגוף שלך שורף ${up ? "יותר" : "פחות"} ממה שהנוסחה מעריכה, ואישרת תיקון של ${fmt(Math.abs(input.adjustmentKcal))} קק"ל ביום.`,
        `${fmt(input.formulaBaseline)} ${up ? "+" : "−"} ${fmt(Math.abs(input.adjustmentKcal))}`,
      ],
      result: `${fmt(input.baseline)} קק"ל ביום`,
    });
  }
  let n = steps.length + 1;

  // 4. Daily target.
  const targetLines: string[] = [];
  const w = input.weeklyGoalKg;
  if (input.byDate?.reached) {
    targetLines.push("כבר הגעת למשקל היעד, ולכן היעד הוא שמירה: לאכול בערך כמו שהגוף שורף.");
  } else if (w === 0) {
    targetLines.push("בחרת שמירה על המשקל, ולכן היעד שווה להוצאה הבסיסית.");
  } else {
    const losing = w < 0;
    const daily = Math.abs(w) * KCAL_PER_KG / 7;
    if (input.byDate) {
      targetLines.push(
        `הקצב נגזר מתאריך היעד (${shortDate(input.byDate.targetDate)}): ${losing ? "ירידה" : "עלייה"} של ${kg(w)} ק"ג בשבוע` +
          (input.byDate.capped ? ", הקצב הבטוח המרבי" : "") + ". הוא מתעדכן לבד לפי השקילות.",
      );
    } else {
      targetLines.push(`בחרת ${losing ? "ירידה" : "עלייה"} של ${kg(w)} ק"ג בשבוע.`);
    }
    targetLines.push(`ק"ג של משקל גוף שווה בערך ל-7,700 קק"ל, ולכן ה${losing ? "גירעון" : "עודף"} היומי הוא ${fmt(daily)}:`);
    targetLines.push(`${kg(w)} × 7,700 ÷ 7 = ${fmt(daily)}`);
    targetLines.push("ומהוצאה הבסיסית:");
    targetLines.push(`${fmt(input.baseline)} ${losing ? "−" : "+"} ${fmt(daily)} = ${fmt(input.baseline + (losing ? -daily : daily))}`);
    if (input.target.limitedByMinimum) {
      const minimum = MIN_CALORIE_TARGET[input.sex];
      const actualDeficit = input.baseline - input.target.targetKcal;
      const actualWeekly = (actualDeficit * 7) / KCAL_PER_KG;
      targetLines.push(
        `זה מתחת לרצפה הבטוחה של ${fmt(minimum)} קק"ל ביום ל${female ? "נשים" : "גברים"}, ולכן היעד הועלה ל-${fmt(minimum)}.`,
      );
      if (actualDeficit > 0) {
        targetLines.push(`בפועל זה גירעון של ${fmt(actualDeficit)} ביום, כלומר ירידה של כ-${kg(Math.round(actualWeekly * 100) / 100)} ק"ג בשבוע.`);
      }
    }
  }
  steps.push({ title: `${n}. היעד היומי שלך`, lines: targetLines, result: `${fmt(input.target.targetKcal)} קק"ל ביום, ביום בלי אימון` });
  n += 1;

  // 5. The day.
  if (input.day) {
    const d = input.day;
    const budget = input.target.targetKcal + Math.max(0, d.workoutKcal);
    const eaten = d.foodKcal + d.drinkKcal + d.snackKcal;
    const left = budget - eaten;
    const lines: string[] = [];
    if (d.workoutKcal > 0) {
      lines.push(`אימונים מוסיפים קלוריות לאכול. היעד ועוד ${fmt(d.workoutKcal)} מאימונים:`);
      lines.push(`${fmt(input.target.targetKcal)} + ${fmt(d.workoutKcal)} = ${fmt(budget)}`);
    } else {
      lines.push(`${d.isToday ? "היום" : "ביום הזה"} אין אימונים, אז המסגרת היא היעד: ${fmt(budget)}.`);
    }
    const parts = [`אוכל ${fmt(d.foodKcal)}`, `שתייה ${fmt(d.drinkKcal)}`];
    const sums = [fmt(d.foodKcal), fmt(d.drinkKcal)];
    if (d.snackKcal > 0) {
      parts.push(`נשנושים שלא נרשמו ${fmt(d.snackKcal)} (הערכה)`);
      sums.push(fmt(d.snackKcal));
    }
    lines.push(`נאכל: ${parts.join(", ")}.`);
    lines.push(`${sums.join(" + ")} = ${fmt(eaten)}`);
    lines.push("מה שנשאר:");
    lines.push(`${fmt(budget)} − ${fmt(eaten)}`);
    steps.push({
      title: `${n}. ${d.isToday ? "היום" : "ביום הזה"}`,
      lines,
      result: left >= 0 ? `נשאר לאכול ${fmt(left)} קק"ל` : `חריגה של ${fmt(-left)} קק"ל`,
    });
    n += 1;
  }

  // 6. Protein, fat, carbohydrates.
  if (input.macros) {
    const m = input.macros;
    const b = m.proteinBasis;
    const lines: string[] = [];
    lines.push(
      m.protein.source === "custom"
        ? `חלבון: ${fmt(m.protein.grams)} גרם, הערך שקבעת. ההמלצה הייתה ${fmt(b.recommendedG)}.`
        : `חלבון: ${b.gPerKg} גרם לכל ק"ג ${b.fromTargetWeight ? "ממשקל היעד" : "ממשקל הגוף"} (${fmt(b.referenceWeightKg)} ק"ג), כלומר ${fmt(b.recommendedG)} גרם` +
            (b.cappedByCalories ? ", מוגבל ל-35% מהקלוריות." : ".") +
            (b.gPerKg >= 1.6 ? " בירידה במשקל או בפעילות, חלבון גבוה עוזר לשמור על השריר." : ""),
    );
    lines.push(
      m.fat.kind === "goal"
        ? `שומן: ${fmt(m.fat.grams)} גרם, הערך שקבעת.`
        : `שומן: בין 20% ל-35% מ-${fmt(input.target.targetKcal)} קק"ל (9 קק"ל בגרם), כלומר בין ${fmt(m.fat.min)} ל-${fmt(m.fat.max)} גרם.`,
    );
    if (m.carbs.source === "custom" && m.carbs.kind === "goal") {
      lines.push(`פחמימות: ${fmt(m.carbs.grams)} גרם, הערך שקבעת.`);
    } else {
      const range = m.carbs.kind === "goal" ? `${fmt(m.carbs.grams)} גרם` : `בין ${fmt(m.carbs.min)} ל-${fmt(m.carbs.max)} גרם`;
      lines.push(`פחמימות: מה שנשאר מהיעד אחרי החלבון והשומן (4 קק"ל בגרם), כלומר ${range}.`);
    }
    steps.push({ title: `${n}. חלבון, פחמימות ושומן`, lines, result: null });
    n += 1;
  }

  // 7. What can be changed.
  const tips: string[] = [];
  if (!input.byDate && w <= -0.5) {
    const softer = w <= -0.75 ? -0.5 : -0.25;
    const softerTarget = targetForPace(input.baseline, softer, input.sex);
    if (Math.round(softerTarget) > Math.round(input.target.targetKcal)) {
      tips.push(`רוצה יעד פחות לחוץ? בקצב של ${kg(softer)} ק"ג בשבוע היעד יהיה כ-${fmt(softerTarget)} קק"ל ביום.`);
    }
  }
  tips.push("גיל, משקל, רמת פעילות וקצב משנים בפרופיל ויעדים, והחישוב מתעדכן מיד.");
  if (Math.round(input.adjustmentKcal) === 0) {
    tips.push("הנוסחה היא הערכה ממוצעת. אחרי כמה שבועות של שקילות ורישום, מסך המשקל יציע לכייל אותה לפי הגוף שלך.");
  }
  steps.push({ title: `${n}. מה אפשר לשנות`, lines: tips, result: null });

  return steps;
}
