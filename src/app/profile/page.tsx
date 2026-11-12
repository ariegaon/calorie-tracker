"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import {
  ACTIVITY_OPTIONS,
  EMPTY_PROFILE_FORM,
  WEEKLY_GOAL_OPTIONS,
  loadProfile,
  profileRowToForm,
  saveProfile,
  type ProfileRow,
} from "@/lib/profile";
import { validateProfile, type ProfileErrors, type ProfileForm } from "@/lib/validation/profile";
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

  async function signOut() {
    try {
      await getSupabase().auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  if (authLoading || loading) return <FullPageMessage>טוען…</FullPageMessage>;
  if (loadError) return <Notice kind="error">{loadError}</Notice>;

  return (
    <main className="space-y-5">
      <header className="space-y-1">
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
            </Select>
          </Field>
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

          <Field
            label="יעד חלבון יומי (גרם, לא חובה)"
            htmlFor="proteinGoalG"
            error={errors.proteinGoalG}
          >
            <TextInput
              id="proteinGoalG"
              inputMode="numeric"
              value={form.proteinGoalG}
              aria-invalid={Boolean(errors.proteinGoalG)}
              onChange={(e) => set("proteinGoalG", e.target.value)}
            />
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

      <div className="space-y-2 border-t border-slate-200 pt-4">
        <Button type="button" variant="dangerGhost" onClick={signOut}>
          התנתקות
        </Button>
        <p className="text-center text-xs text-slate-500">מחובר כ-{session?.user.email}</p>
      </div>
    </main>
  );
}
