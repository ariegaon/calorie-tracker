// The expenditure estimate for a profile, with the user's confirmed calibration applied.
// One place for it, so the home screen, the weight screen and the reports always agree.

import { baselineExpenditure, bmrMifflinStJeor, calorieTargetForPace, type CalorieTarget } from "@/lib/calculations/energy";
import { paceForTargetDate, type PaceForDate } from "@/lib/calculations/goal";
import { macroTargets, type MacroTargets } from "@/lib/calculations/macros";
import type { ProfileRow } from "@/lib/profile";
import { ageInYears } from "@/lib/validation/profile";
import { calibratedBaseline } from "@/lib/weight/trend";

export type ProfileEnergy = {
  bmr: number;
  /** Baseline before calibration: BMR times the everyday activity factor. */
  formulaBaseline: number;
  /** Baseline in use: the formula plus the confirmed adjustment. */
  baseline: number;
  adjustmentKcal: number;
  target: CalorieTarget;
  /** The weekly pace the target uses. */
  weeklyGoalKg: number;
  /** Set when the pace comes from a target date (null when a fixed pace is chosen or the date has passed). */
  goalPace: Exclude<PaceForDate, { status: "past" }> | null;
  /** Protein goal and fat/carbs ranges (or the user's own values), from the calorie target. */
  macros: MacroTargets;
};

function ownGoal(value: number | null): number | null {
  return value === null ? null : Number(value);
}

export function profileEnergy(
  profile: ProfileRow,
  weightKg: number | null,
  now: Date,
  adjustmentKcal: number,
): ProfileEnergy | null {
  const sex = profile.sex_for_bmr;
  const age = profile.birth_date ? ageInYears(profile.birth_date, now) : null;
  if (!sex || age === null || age <= 0 || profile.height_cm === null || weightKg === null) return null;
  const bmr = bmrMifflinStJeor({ sex, weightKg, heightCm: Number(profile.height_cm), ageYears: age });
  const formulaBaseline = baselineExpenditure(bmr, Number(profile.activity_factor));
  const baseline = calibratedBaseline(formulaBaseline, bmr, adjustmentKcal);
  // With a target date the pace is recomputed every day from the latest weight, so it follows progress.
  let goalPace: ProfileEnergy["goalPace"] = null;
  let weeklyGoalKg = Number(profile.weekly_weight_change_goal_kg ?? 0);
  if (profile.target_date && profile.target_weight_kg !== null) {
    const pace = paceForTargetDate(weightKg, Number(profile.target_weight_kg), now, profile.target_date);
    if (pace.status !== "past") {
      goalPace = pace;
      weeklyGoalKg = pace.weeklyKg;
    }
  }
  const target = calorieTargetForPace(baseline, weeklyGoalKg, sex);
  const macros = macroTargets({
    targetKcal: target.targetKcal,
    weightKg,
    targetWeightKg: profile.target_weight_kg === null ? null : Number(profile.target_weight_kg),
    weeklyGoalKg,
    activityFactor: Number(profile.activity_factor),
    custom: {
      proteinG: ownGoal(profile.daily_protein_goal_g),
      fatG: ownGoal(profile.daily_fat_goal_g),
      carbsG: ownGoal(profile.daily_carbs_goal_g),
    },
  });
  return { bmr, formulaBaseline, baseline, adjustmentKcal, target, weeklyGoalKg, goalPace, macros };
}
