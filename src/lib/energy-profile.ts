// The expenditure estimate for a profile, with the user's confirmed calibration applied.
// One place for it, so the home screen, the weight screen and the reports always agree.

import { baselineExpenditure, bmrMifflinStJeor, calorieTargetForPace, type CalorieTarget } from "@/lib/calculations/energy";
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
};

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
  const target = calorieTargetForPace(baseline, Number(profile.weekly_weight_change_goal_kg ?? 0), sex);
  return { bmr, formulaBaseline, baseline, adjustmentKcal, target };
}
