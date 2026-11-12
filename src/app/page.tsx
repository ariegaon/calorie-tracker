"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { ACTIVITY_OPTIONS, WEEKLY_GOAL_OPTIONS, loadProfile, type ProfileRow } from "@/lib/profile";
import { ageInYears } from "@/lib/validation/profile";
import { baselineExpenditure, bmrMifflinStJeor, calorieTargetForPace } from "@/lib/calculations/energy";
import { Button, Card, FullPageMessage, Notice } from "@/components/ui";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function estimateEnergy(profile: ProfileRow, weightKg: number | null, age: number | null) {
  const sex = profile.sex_for_bmr;
  if (!sex || age === null || age <= 0 || profile.height_cm === null || weightKg === null) return null;
  const bmr = bmrMifflinStJeor({ sex, weightKg, heightCm: Number(profile.height_cm), ageYears: age });
  const baseline = baselineExpenditure(bmr, Number(profile.activity_factor));
  const target = calorieTargetForPace(baseline, Number(profile.weekly_weight_change_goal_kg ?? 0), sex);
  return { bmr, baseline, target };
}

export default function HomePage() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    Promise.all([
      loadProfile(userId),
      getSupabase()
        .from("weight_logs")
        .select("weight_kg")
        .eq("user_id", userId)
        .order("measured_at", { ascending: false })
        .limit(1),
    ])
      .then(([row, weights]) => {
        if (cancelled) return;
        if (weights.error) throw new Error(weights.error.message);
        if (!row?.onboarding_completed_at) {
          router.replace("/profile");
          return;
        }
        const latest = (weights.data as { weight_kg: number }[] | null)?.[0];
        setLatestWeightKg(latest ? Number(latest.weight_kg) : null);
        setProfile(row);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("לא הצלחנו לטעון את הנתונים. בדוק את החיבור ונסה לרענן.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, router]);

  async function signOut() {
    try {
      await getSupabase().auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  if (authError) return <Notice kind="error">{authError}</Notice>;
  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (authLoading || loading || !profile) return <FullPageMessage>טוען…</FullPageMessage>;

  const age = profile.birth_date ? ageInYears(profile.birth_date, new Date()) : null;
  const activity = ACTIVITY_OPTIONS.find((o) => Number(o.value) === Number(profile.activity_factor));
  const pace = WEEKLY_GOAL_OPTIONS.find((o) => Number(o.value) === Number(profile.weekly_weight_change_goal_kg));

  const weightKg = latestWeightKg ?? profile.start_weight_kg;
  const energy = estimateEnergy(profile, weightKg === null ? null : Number(weightKg), age);
  const kcal = (value: number) => `${Math.round(value).toLocaleString("he-IL")} קק"ל`;

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">שלום{profile.display_name ? `, ${profile.display_name}` : ""}</h1>
        <p className="text-sm text-slate-600">הפרופיל שלך שמור. מסך הבית המלא ייבנה בשלבים הבאים.</p>
      </header>

      {energy ? (
        <Card>
          <h2 className="mb-1 font-semibold">ההוצאה הקלורית היומית שלך (הערכה)</h2>
          <dl className="divide-y divide-slate-100">
            <Row label="במנוחה מלאה (BMR)" value={kcal(energy.bmr)} />
            <Row label="ביום רגיל בלי אימון" value={kcal(energy.baseline)} />
            <Row label="יעד צריכה לפי הקצב שבחרת" value={kcal(energy.target.targetKcal)} />
          </dl>
          {energy.target.limitedByMinimum ? (
            <div className="mt-2">
              <Notice kind="info">
                הקצב שבחרת דורש פחות מהמינימום המומלץ, ולכן היעד הועלה למינימום. הקצב בפועל יהיה איטי יותר.
              </Notice>
            </div>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            מחושב בנוסחת Mifflin-St Jeor לפי משקל של {Number(weightKg)} ק"ג, כפול רמת הפעילות היומיומית שבחרת.
            זו הערכה ולא מדידה. קלוריות של אימונים יתווספו בנפרד ביום שבו התאמנת.
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 font-semibold">הנתונים שלך</h2>
        <dl className="divide-y divide-slate-100">
          <Row label="גיל" value={age === null ? "לא הוזן" : String(age)} />
          <Row label="גובה" value={profile.height_cm === null ? "לא הוזן" : `${profile.height_cm} ס"מ`} />
          <Row
            label="משקל פתיחה"
            value={profile.start_weight_kg === null ? "לא הוזן" : `${profile.start_weight_kg} ק"ג`}
          />
          <Row
            label="משקל יעד"
            value={profile.target_weight_kg === null ? "לא הוזן" : `${profile.target_weight_kg} ק"ג`}
          />
          <Row label="קצב רצוי" value={pace?.label ?? "לא נבחר"} />
          <Row label="פעילות יומיומית" value={activity?.label ?? "לא נבחרה"} />
          <Row
            label="יעד חלבון"
            value={profile.daily_protein_goal_g === null ? "לא הוגדר" : `${profile.daily_protein_goal_g} גרם`}
          />
          <Row label="יעד שתייה" value={`${profile.daily_water_goal_ml} מ"ל`} />
        </dl>
      </Card>

      <Link
        href="/profile"
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white hover:bg-emerald-700"
      >
        עריכת פרופיל ויעדים
      </Link>

      <Button type="button" variant="secondary" onClick={signOut}>
        התנתקות
      </Button>

      <p className="text-center text-xs text-slate-500">מחובר כ-{session?.user.email}</p>
    </main>
  );
}
