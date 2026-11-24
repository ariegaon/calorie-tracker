// Daily protein, fat and carbohydrate targets. Pure functions, so they run under `node --test` as is.
//
// Basis (see the profile screen for the text the user sees):
// - Protein above the RDA (0.8 g/kg) helps keep lean mass during an energy deficit
//   (Hudson et al., Adv Nutr 2020, meta-analysis). ACSM for active adults: 1.2–1.7 g/kg;
//   for muscle gain the useful range is about 1.6–2.2 g/kg (Morton et al., BJSM 2018).
//   We use 1.6 g/kg when losing, gaining or physically active, 1.2 g/kg otherwise.
// - With a lower target weight, protein is computed from the target weight, so heavier people
//   do not get unrealistic numbers. A practical convention, not a trial result.
// - Fat: 20–35% of energy, carbohydrates 45–65%, protein 10–35% (Institute of Medicine AMDR).
//   Carbohydrates are whatever is left after protein and fat; DIETFITS (JAMA 2018) found no
//   difference in weight loss between healthy low-fat and healthy low-carb diets.

export const PROTEIN_G_PER_KG_ACTIVE = 1.6;
export const PROTEIN_G_PER_KG_BASE = 1.2;
export const FAT_SHARE_MIN = 0.2;
export const FAT_SHARE_MAX = 0.35;
export const PROTEIN_SHARE_MAX = 0.35;
export const CARBS_SHARE_MIN = 0.45;

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

export type MacroSource = "auto" | "custom";

/** A single daily goal (protein, or a value the user set) or a recommended range. */
export type MacroTarget =
  | { kind: "goal"; grams: number; source: MacroSource }
  | { kind: "range"; min: number; max: number; source: "auto" };

export type MacroTargets = {
  protein: MacroTarget & { kind: "goal" };
  fat: MacroTarget;
  carbs: MacroTarget;
  /** The protein recommendation behind the auto value, shown even when the user set their own. */
  proteinBasis: {
    gPerKg: number;
    referenceWeightKg: number;
    /** True when the reference is the target weight rather than the current one. */
    fromTargetWeight: boolean;
    /** True when g/kg × weight was above 35% of the calories and was lowered to it. */
    cappedByCalories: boolean;
    recommendedG: number;
  };
  /** The recommended ranges, shown beside a user's own value. */
  recommended: { fat: { min: number; max: number }; carbs: { min: number; max: number } };
  /** True when even the top of the carbohydrate range is below 45% of the calories. */
  carbsBelowUsualRange: boolean;
};

export type MacroInput = {
  targetKcal: number;
  weightKg: number;
  targetWeightKg: number | null;
  /** Negative when losing, positive when gaining. */
  weeklyGoalKg: number;
  activityFactor: number;
  custom: { proteinG: number | null; fatG: number | null; carbsG: number | null };
};

function round5(value: number): number {
  return Math.round(value / 5) * 5;
}

/** g/kg of protein: the higher figure when changing weight or physically active. */
export function proteinGramsPerKg(weeklyGoalKg: number, activityFactor: number): number {
  return weeklyGoalKg !== 0 || activityFactor >= 1.55 ? PROTEIN_G_PER_KG_ACTIVE : PROTEIN_G_PER_KG_BASE;
}

/** The weight protein is computed from: the target weight when it is lower than the current one. */
export function proteinReferenceWeight(weightKg: number, targetWeightKg: number | null): number {
  return targetWeightKg !== null && targetWeightKg > 0 && targetWeightKg < weightKg ? targetWeightKg : weightKg;
}

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function macroTargets(input: MacroInput): MacroTargets {
  const kcal = Math.max(0, input.targetKcal);
  const gPerKg = proteinGramsPerKg(input.weeklyGoalKg, input.activityFactor);
  const referenceWeightKg = proteinReferenceWeight(input.weightKg, input.targetWeightKg);
  const byWeight = gPerKg * referenceWeightKg;
  const ceiling = (kcal * PROTEIN_SHARE_MAX) / KCAL_PER_G_PROTEIN;
  const cappedByCalories = byWeight > ceiling;
  const recommendedG = round5(Math.min(byWeight, ceiling));

  const customProtein = positive(input.custom.proteinG);
  const customFat = positive(input.custom.fatG);
  const customCarbs = positive(input.custom.carbsG);

  const proteinG = customProtein ?? recommendedG;
  const fatRange = {
    min: Math.round((kcal * FAT_SHARE_MIN) / KCAL_PER_G_FAT),
    max: Math.round((kcal * FAT_SHARE_MAX) / KCAL_PER_G_FAT),
  };

  // Carbohydrates fill what protein and fat leave.
  const rest = kcal - proteinG * KCAL_PER_G_PROTEIN;
  const carbsFor = (fatG: number) => Math.max(0, Math.round((rest - fatG * KCAL_PER_G_FAT) / KCAL_PER_G_CARBS));
  const carbsRange = customFat !== null
    ? { min: carbsFor(customFat), max: carbsFor(customFat) }
    : { min: carbsFor(fatRange.max), max: carbsFor(fatRange.min) };

  const fat: MacroTarget = customFat !== null
    ? { kind: "goal", grams: Math.round(customFat), source: "custom" }
    : { kind: "range", min: fatRange.min, max: fatRange.max, source: "auto" };
  let carbs: MacroTarget;
  if (customCarbs !== null) carbs = { kind: "goal", grams: Math.round(customCarbs), source: "custom" };
  else if (carbsRange.min === carbsRange.max) carbs = { kind: "goal", grams: carbsRange.min, source: "auto" };
  else carbs = { kind: "range", min: carbsRange.min, max: carbsRange.max, source: "auto" };

  return {
    protein: { kind: "goal", grams: Math.round(proteinG), source: customProtein !== null ? "custom" : "auto" },
    fat,
    carbs,
    proteinBasis: { gPerKg, referenceWeightKg, fromTargetWeight: referenceWeightKg !== input.weightKg, cappedByCalories, recommendedG },
    recommended: { fat: fatRange, carbs: carbsRange },
    carbsBelowUsualRange: kcal > 0 && carbsRange.max * KCAL_PER_G_CARBS < kcal * CARBS_SHARE_MIN,
  };
}

export type MacroStatus = "below" | "within" | "above";

/** Where the day's grams stand: a goal is met at 100%; a range is met between its ends. */
export function macroStatus(target: MacroTarget, grams: number): MacroStatus {
  if (target.kind === "goal") return grams >= target.grams ? "within" : "below";
  if (grams < target.min) return "below";
  if (grams > target.max) return "above";
  return "within";
}
