// Builds the "how did we calculate this?" input from what the screens already have.

import type { ExplainInput } from "@/lib/calculations/explain";
import type { ProfileEnergy } from "@/lib/energy-profile";
import { ACTIVITY_OPTIONS, type ProfileRow } from "@/lib/profile";
import { ageInYears } from "@/lib/validation/profile";

export function buildExplainInput(
  profile: ProfileRow,
  energy: ProfileEnergy,
  weightKg: number,
  weightSource: ExplainInput["weightSource"],
  now: Date,
  day: ExplainInput["day"],
): ExplainInput | null {
  const age = profile.birth_date ? ageInYears(profile.birth_date, now) : null;
  if (!profile.sex_for_bmr || age === null || profile.height_cm === null) return null;
  const factor = Number(profile.activity_factor);
  const option = ACTIVITY_OPTIONS.find((o) => Number(o.value) === factor);
  const pace = energy.goalPace;
  return {
    sex: profile.sex_for_bmr,
    ageYears: age,
    heightCm: Number(profile.height_cm),
    weightKg,
    weightSource,
    activityFactor: factor,
    activityLabel: option ? `${option.label} (${option.detail})` : String(factor),
    bmr: energy.bmr,
    formulaBaseline: energy.formulaBaseline,
    adjustmentKcal: energy.adjustmentKcal,
    baseline: energy.baseline,
    weeklyGoalKg: energy.weeklyGoalKg,
    byDate:
      pace && profile.target_date
        ? { targetDate: profile.target_date, capped: pace.status === "capped", reached: pace.status === "reached" }
        : null,
    target: energy.target,
    day,
    macros: energy.macros,
  };
}
