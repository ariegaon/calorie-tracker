"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  ACTIVITY_OPTIONS,
  EMPTY_PROFILE_FORM,
  PACE_BY_DATE,
  WEEKLY_GOAL_OPTIONS,
  loadProfile,
  profileRowToForm,
  saveProfile,
  type ProfileRow,
} from "@/lib/profile";
import { parseNumber, validateProfile, type ProfileErrors, type ProfileForm } from "@/lib/validation/profile";
import { BottomNav } from "@/components/BottomNav";
import { paceForTargetDate } from "@/lib/calculations/goal";
import { profileEnergy } from "@/lib/energy-profile";
import { loadLatestWeightKg } from "@/lib/weight/data";
import { loadCalibrationAdjustment } from "@/lib/weight/extras-data";
import { MacroGoalsFields } from "@/components/MacroGoalsFields";
import { CalculationExplainer } from "@/components/CalculationExplainer";
import { buildExplainInput } from "@/lib/explain-input";
import { Button, Card, Field, FullPageMessage, Notice, Select, TextInput } from "@/components/ui";

export default function ProfilePage() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;

  const [existing, setExisting] = useState<ProfileRow | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null);
  const [adjustment, setAdjustment] = useState(0);

  // For the macro recommendation: the same weight and calibration the home screen uses.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([loadLatestWeightKg(userId), loadCalibrationAdjustment(userId)])
      .then(([weight, calibration]) => {
        if (cancelled) return;
        setLatestWeightKg(weight);
        setAdjustment(calibration);
      })
      .catch(() => {
        // The recommendation then uses the weight in the form.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    loadProfile(userId)
      .then((row) => {
        if (cancelled) return;
        setExisting(row);
        if (row) setForm(profileRowToForm(row));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("לא הצלחנו לטעון את הפרופיל. בדוק את החיבור ונסה לרענן.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, router]);

  const isOnboarding = !existing?.onboarding_completed_at;

  // The calculation for what is in the form now, before it is saved.
  const preview = useMemo(() => {
    const sex = form.sexForBmr === "male" || form.sexForBmr === "female" ? form.sexForBmr : null;
    const height = parseNumber(form.heightCm);
    const target = parseNumber(form.targetWeightKg);
    const weight = latestWeightKg ?? parseNumber(form.startWeightKg);
    const byDate = form.weeklyGoalKg === PACE_BY_DATE;
    const row: ProfileRow = {
      ...(existing ?? ({} as ProfileRow)),
      sex_for_bmr: sex,
      birth_date: form.birthDate || null,
      height_cm: height,
      target_weight_kg: target,
      activity_factor: parseNumber(form.activityFactor) ?? 1.2,
      weekly_weight_change_goal_kg: byDate ? null : parseNumber(form.weeklyGoalKg),
      target_date: byDate && form.targetDate ? form.targetDate : null,
      daily_protein_goal_g: null,
      daily_fat_goal_g: null,
      daily_carbs_goal_g: null,
    };
    if (weight === null) return null;
    const now = new Date();
    const energy = profileEnergy(row, weight, now, adjustment);
    if (!energy) return null;
    return {
      macros: energy.macros,
      explain: buildExplainInput(row, energy, weight, latestWeightKg !== null ? "weigh_in" : "profile", now, null),
    };
  }, [form, existing, latestWeightKg, adjustment]);

  function set<K extends keyof ProfileForm>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;
    setSaveError(null);

    const result = validateProfile(form);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError("יש שדות שצריך לתקן");
      return;
    }

    setSaving(true);
    try {
      await saveProfile(userId, result.values, existing);
      router.replace("/");
    } catch {
      setSaveError("השמירה נכשלה. הנתונים לא נשמרו, נסה שוב.");
      setSaving(false);
    }
  }

  if (authLoading || loading) return <FullPageMessage>טוען…</FullPageMessage>;
  if (loadError) return <Notice kind="error">{loadError}</Notice>;

  return (
    <main className={isOnboarding ? "space-y-5" : "space-y-5 pb-20"}>
      <header className="space-y-1">
        {!isOnboarding ? (
          <Link href="/settings" className="text-sm font-medium text-emerald-700">
            <span aria-hidden="true">→ </span>הגדרות
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold">{isOnboarding ? "בוא נכיר" : "פרופיל ויעדים"}</h1>
        <p className="text-sm text-slate-600">
          {isOnboarding
            ? "הנתונים האלה משמשים לחישוב ההוצאה הקלורית שלך. אפשר לשנות אותם בכל עת."
            : "שינוי כאן ישפיע על החישובים מעכשיו והלאה."}
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Card className="space-y-4">
          <h2 className="font-semibold">פרטים אישיים</h2>

          <Field label="שם (לא חובה)" htmlFor="displayName" error={errors.displayName}>
            <TextInput
              id="displayName"
              autoComplete="given-name"
              value={form.displayName}
              aria-invalid={Boolean(errors.displayName)}
              onChange={(e) => set("displayName", e.target.value)}
            />
          </Field>

          <Field
            label="מין לצורך החישוב"
            htmlFor="sexForBmr"
            hint="נוסחת ההוצאה הקלורית במנוחה שונה לגברים ולנשים."
            error={errors.sexForBmr}
          >
            <Select
              id="sexForBmr"
              value={form.sexForBmr}
              aria-invalid={Boolean(errors.sexForBmr)}
              onChange={(e) => set("sexForBmr", e.target.value)}
            >
              <option value="">בחר…</option>
              <option value="male">גבר</option>
              <option value="female">אישה</option>
            </Select>
          </Field>

          <Field label="תאריך לידה" htmlFor="birthDate" error={errors.birthDate}>
            <TextInput
              id="birthDate"
              type="date"
              value={form.birthDate}
              aria-invalid={Boolean(errors.birthDate)}
              onChange={(e) => set("birthDate", e.target.value)}
            />
          </Field>

          <Field label={'גובה (ס"מ)'} htmlFor="heightCm" error={errors.heightCm}>
            <TextInput
              id="heightCm"
              inputMode="decimal"
              value={form.heightCm}
              aria-invalid={Boolean(errors.heightCm)}
              onChange={(e) => set("heightCm", e.target.value)}
            />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">משקל ויעד</h2>

          <Field
            label={isOnboarding ? 'משקל נוכחי (ק"ג)' : 'משקל פתיחה (ק"ג)'}
            htmlFor="startWeightKg"
            hint={
              isOnboarding
                ? "יירשם גם כשקילה הראשונה שלך."
                : "המשקל שממנו התחלת. שקילות חדשות מוסיפים במסך המשקל."
            }
            error={errors.startWeightKg}
          >
            <TextInput
              id="startWeightKg"
              inputMode="decimal"
              value={form.startWeightKg}
              aria-invalid={Boolean(errors.startWeightKg)}
              onChange={(e) => set("startWeightKg", e.target.value)}
            />
          </Field>

          <Field label={'משקל יעד (ק"ג)'} htmlFor="targetWeightKg" error={errors.targetWeightKg}>
            <TextInput
              id="targetWeightKg"
              inputMode="decimal"
              value={form.targetWeightKg}
              aria-invalid={Boolean(errors.targetWeightKg)}
              onChange={(e) => set("targetWeightKg", e.target.value)}
            />
          </Field>

          <Field label="קצב רצוי" htmlFor="weeklyGoalKg" error={errors.weeklyGoalKg}>
            <Select
              id="weeklyGoalKg"
              value={form.weeklyGoalKg}
              aria-invalid={Boolean(errors.weeklyGoalKg)}
              onChange={(e) => set("weeklyGoalKg", e.target.value)}
            >
              {WEEKLY_GOAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value={PACE_BY_DATE}>להגיע למשקל היעד עד תאריך שאבחר</option>
            </Select>
          </Field>

          {form.weeklyGoalKg === PACE_BY_DATE ? (
            <Field label="תאריך יעד" htmlFor="targetDate" error={errors.targetDate}>
              <TextInput
                id="targetDate"
                type="date"
                value={form.targetDate}
                aria-invalid={Boolean(errors.targetDate)}
                onChange={(e) => set("targetDate", e.target.value)}
              />
              <TargetDatePreview
                currentKg={parseNumber(form.startWeightKg)}
                targetKg={parseNumber(form.targetWeightKg)}
                targetDate={form.targetDate}
              />
            </Field>
          ) : null}

          {preview?.explain ? (
            <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-600">
              <span>
                היעד היומי לפי מה שמוזן כאן:{" "}
                <span className="font-semibold text-slate-900">
                  {Math.round(preview.explain.target.targetKcal).toLocaleString("he-IL")} קק"ל
                </span>
              </span>
              <CalculationExplainer input={preview.explain} />
            </p>
          ) : null}
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">שגרה ויעדים יומיים</h2>

          <Field
            label="פעילות יומיומית, בלי אימונים"
            htmlFor="activityFactor"
            hint="אימונים נספרים בנפרד, אז אל תכלול אותם כאן. אחרת הקלוריות שלהם ייספרו פעמיים."
            error={errors.activityFactor}
          >
            <Select
              id="activityFactor"
              value={form.activityFactor}
              aria-invalid={Boolean(errors.activityFactor)}
              onChange={(e) => set("activityFactor", e.target.value)}
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}: {option.detail}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={'יעד שתייה יומי (מ"ל)'} htmlFor="waterGoalMl" error={errors.waterGoalMl}>
            <TextInput
              id="waterGoalMl"
              inputMode="numeric"
              value={form.waterGoalMl}
              aria-invalid={Boolean(errors.waterGoalMl)}
              onChange={(e) => set("waterGoalMl", e.target.value)}
            />
          </Field>

          <MacroGoalsFields form={form} errors={errors} macros={preview?.macros ?? null} onChange={(key, value) => set(key, value)} />
        </Card>

        {saveError ? <Notice kind="error">{saveError}</Notice> : null}

        <Button type="submit" disabled={saving}>
          {saving ? "שומר…" : isOnboarding ? "שמור והמשך" : "שמור שינויים"}
        </Button>
        {!isOnboarding ? (
          <Button type="button" variant="secondary" onClick={() => router.replace("/")}>
            ביטול
          </Button>
        ) : null}
      </form>

      {!isOnboarding ? <BottomNav /> : null}
    </main>
  );
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.${year}`;
}

/** What the chosen date means, from the weight in the form. The home screen recomputes it daily from the latest weigh-in. */
function TargetDatePreview({
  currentKg,
  targetKg,
  targetDate,
}: {
  currentKg: number | null;
  targetKg: number | null;
  targetDate: string;
}) {
  if (currentKg === null || targetKg === null || targetDate === "") return null;
  const pace = paceForTargetDate(currentKg, targetKg, new Date(), targetDate);
  const kg = (value: number) => Math.abs(value).toFixed(2);
  let text: string;
  let warn = false;
  if (pace.status === "past") return null;
  if (pace.status === "reached") text = "כבר הגעת למשקל היעד, ולכן היעד היומי יהיה שמירה על המשקל.";
  else if (pace.status === "ok") {
    text = `${pace.weeklyKg < 0 ? "ירידה" : "עלייה"} של ${kg(pace.weeklyKg)} ק"ג בשבוע. היעד היומי יתעדכן לבד לפי השקילות.`;
  } else {
    warn = true;
    text =
      `התאריך קרוב מדי: זה ${kg(pace.requestedWeeklyKg)} ק"ג בשבוע. ` +
      `האפליקציה תתכנן לכל היותר ${kg(pace.weeklyKg)} ק"ג בשבוע, ובקצב הזה היעד יושג בערך ב-${formatDate(pace.realisticDate)}.`;
  }
  return <p className={"mt-1.5 text-sm " + (warn ? "font-medium text-amber-700" : "text-slate-600")}>{text}</p>;
}
