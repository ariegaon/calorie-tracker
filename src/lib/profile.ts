import { getSupabase } from "@/lib/supabase/client";
import type { ProfileForm, ProfileValues } from "@/lib/validation/profile";

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  sex_for_bmr: "male" | "female" | null;
  birth_date: string | null;
  height_cm: number | null;
  start_weight_kg: number | null;
  target_weight_kg: number | null;
  activity_factor: number;
  weekly_weight_change_goal_kg: number | null;
  daily_protein_goal_g: number | null;
  daily_water_goal_ml: number;
  onboarding_completed_at: string | null;
};

const COLUMNS =
  "user_id, display_name, sex_for_bmr, birth_date, height_cm, start_weight_kg, target_weight_kg, " +
  "activity_factor, weekly_weight_change_goal_kg, daily_protein_goal_g, daily_water_goal_ml, onboarding_completed_at";

export const ACTIVITY_OPTIONS = [
  { value: "1.2", label: "יושבנית", detail: "עבודה בישיבה, מעט הליכה" },
  { value: "1.35", label: "קלה", detail: "הליכה יומיומית, עמידה חלק מהיום" },
  { value: "1.55", label: "בינונית", detail: "עבודה פיזית או הרבה תנועה ביום" },
] as const;

export const WEEKLY_GOAL_OPTIONS = [
  { value: "-0.75", label: "ירידה של 0.75 ק\"ג בשבוע" },
  { value: "-0.5", label: "ירידה של 0.5 ק\"ג בשבוע" },
  { value: "-0.25", label: "ירידה של 0.25 ק\"ג בשבוע" },
  { value: "0", label: "שמירה על המשקל" },
  { value: "0.25", label: "עלייה של 0.25 ק\"ג בשבוע" },
] as const;

export const EMPTY_PROFILE_FORM: ProfileForm = {
  displayName: "",
  sexForBmr: "",
  birthDate: "",
  heightCm: "",
  startWeightKg: "",
  targetWeightKg: "",
  activityFactor: "1.2",
  weeklyGoalKg: "-0.5",
  proteinGoalG: "",
  waterGoalMl: "2500",
};

function text(value: number | null): string {
  return value === null ? "" : String(value);
}

export function profileRowToForm(row: ProfileRow): ProfileForm {
  return {
    displayName: row.display_name ?? "",
    sexForBmr: row.sex_for_bmr ?? "",
    birthDate: row.birth_date ?? "",
    heightCm: text(row.height_cm),
    startWeightKg: text(row.start_weight_kg),
    targetWeightKg: text(row.target_weight_kg),
    activityFactor: String(row.activity_factor),
    weeklyGoalKg: row.weekly_weight_change_goal_kg === null ? "-0.5" : String(row.weekly_weight_change_goal_kg),
    proteinGoalG: text(row.daily_protein_goal_g),
    waterGoalMl: String(row.daily_water_goal_ml),
  };
}

export async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ProfileRow | null) ?? null;
}

/**
 * Saves the profile. On the first save (onboarding) the current weight is also
 * recorded as the first weigh-in, so the weight history starts from day one.
 */
export async function saveProfile(userId: string, values: ProfileValues, existing: ProfileRow | null): Promise<void> {
  const supabase = getSupabase();
  const firstSave = !existing?.onboarding_completed_at;

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      display_name: values.displayName,
      sex_for_bmr: values.sexForBmr,
      birth_date: values.birthDate,
      height_cm: values.heightCm,
      start_weight_kg: values.startWeightKg,
      target_weight_kg: values.targetWeightKg,
      activity_factor: values.activityFactor,
      weekly_weight_change_goal_kg: values.weeklyGoalKg,
      daily_protein_goal_g: values.proteinGoalG,
      daily_water_goal_ml: values.waterGoalMl,
      onboarding_completed_at: existing?.onboarding_completed_at ?? new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);

  if (firstSave) {
    const { error: weightError } = await supabase.from("weight_logs").insert({
      user_id: userId,
      weight_kg: values.startWeightKg,
      source: "manual",
      notes: "משקל פתיחה",
    });
    if (weightError) throw new Error(weightError.message);
  }
}
