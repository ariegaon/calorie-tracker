"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { ageInYears } from "@/lib/validation/profile";
import { baselineExpenditure, bmrMifflinStJeor, calorieTargetForPace } from "@/lib/calculations/energy";
import { addDays, defaultEntryTime, formatDayLabel, formatTime, isSameDay, startOfDay } from "@/lib/day/dates";
import { loadDay, saveDrink, type LoadedDay } from "@/lib/day/data";
import { buildTimeline, summarizeDay, type TimelineEvent, type TimelineKind } from "@/lib/day/summary";
import type { ActivityRow, DrinkRow, FoodRow, WeightRow } from "@/lib/day/entries";
import { Card, FullPageMessage, Notice } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { FoodForm } from "@/components/forms/FoodForm";
import { DrinkForm } from "@/components/forms/DrinkForm";
import { ActivityForm } from "@/components/forms/ActivityForm";
import { WeightForm } from "@/components/forms/WeightForm";
import { MealForm } from "@/components/forms/MealForm";
import { AnalyzeMeal } from "@/components/forms/AnalyzeMeal";

type SheetState =
  | { kind: "ai" }
  | { kind: "meal"; existing: FoodRow }
  | { kind: "food"; existing: FoodRow | null }
  | { kind: "drink"; existing: DrinkRow | null }
  | { kind: "activity"; existing: ActivityRow | null }
  | { kind: "weight"; existing: WeightRow | null };

const KIND_ICON: Record<TimelineKind, string> = { food: "🍽", drink: "🥤", activity: "🏃", weight: "⚖" };
const KIND_LABEL: Record<TimelineKind, string> = { food: "מזון", drink: "משקה", activity: "פעילות", weight: "שקילה" };

function sheetTitle(sheet: SheetState): string {
  switch (sheet.kind) {
    case "ai":
      return "ניתוח ארוחה ב-AI";
    case "meal":
      return "עריכת ארוחה";
    case "food":
      return "הוספת מזון ידנית";
    case "drink":
      return sheet.existing ? "עריכת משקה" : "הוספת משקה";
    case "activity":
      return sheet.existing ? "עריכת פעילות" : "הוספת פעילות";
    case "weight":
      return sheet.existing ? "עריכת שקילה" : "הזנת משקל";
  }
}

function estimateEnergy(profile: ProfileRow, weightKg: number | null, age: number | null) {
  const sex = profile.sex_for_bmr;
  if (!sex || age === null || age <= 0 || profile.height_cm === null || weightKg === null) return null;
  const bmr = bmrMifflinStJeor({ sex, weightKg, heightCm: Number(profile.height_cm), ageYears: age });
  const baseline = baselineExpenditure(bmr, Number(profile.activity_factor));
  const target = calorieTargetForPace(baseline, Number(profile.weekly_weight_change_goal_kg ?? 0), sex);
  return { bmr, baseline, target };
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("he-IL");
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={"text-sm " + (strong ? "font-semibold text-slate-900" : "text-slate-600")}>{label}</dt>
      <dd className={"tabular-nums " + (strong ? "font-bold" : "font-medium")}>{value}</dd>
    </div>
  );
}

function ProgressBar({ label, value, goal, unit }: { label: string; value: number; goal: number | null; unit: string }) {
  const percent = goal && goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm tabular-nums text-slate-900">
          <span className="font-bold">{formatNumber(value)}</span>
          {goal ? ` מתוך ${formatNumber(goal)}` : ""} {unit}
          {percent !== null && percent >= 100 ? " ✓" : ""}
        </span>
      </div>
      {percent !== null ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2.5 overflow-hidden rounded-full bg-slate-200"
        >
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-100 active:bg-slate-200"
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {icon}
      </span>
      {label}
    </button>
  );
}

function TimelineItem({ event, onOpen }: { event: TimelineEvent; onOpen: () => void }) {
  let kcalText: ReactNode = null;
  if (event.kcal !== null) {
    const burned = event.kcal < 0;
    kcalText = (
      <span className={"shrink-0 text-sm font-semibold tabular-nums " + (burned ? "text-sky-700" : "text-slate-900")}>
        {burned ? "נשרפו " : ""}
        {formatNumber(Math.abs(event.kcal))} קק"ל
      </span>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${KIND_LABEL[event.kind]}: ${event.title}, עריכה`}
        className="flex w-full items-center gap-3 py-3 text-start hover:bg-slate-50"
      >
        <span className="w-11 shrink-0 text-sm tabular-nums text-slate-500">{formatTime(event.at)}</span>
        <span aria-hidden="true" className="shrink-0 text-xl">
          {KIND_ICON[event.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{event.title}</span>
          {event.detail ? <span className="block truncate text-xs text-slate-500">{event.detail}</span> : null}
        </span>
        {kcalText}
      </button>
    </li>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const userId = session?.user.id ?? null;

  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [data, setData] = useState<LoadedDay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [addingWater, setAddingWater] = useState(false);

  // Profile: loaded once per user.
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
        if (!row?.onboarding_completed_at) {
          router.replace("/profile");
          return;
        }
        setProfile(row);
      })
      .catch(() => {
        if (!cancelled) setLoadError("לא הצלחנו לטעון את הפרופיל. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, router]);

  // Day entries: reloaded when the day changes or after a save.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setRefreshing(true);
    loadDay(userId, day)
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setLoadError(null);
        setRefreshing(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("לא הצלחנו לטעון את נתוני היום. בדוק את החיבור ונסה שוב.");
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, day, reloadKey]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const onSaved = useCallback(() => {
    setSheet(null);
    setReloadKey((key) => key + 1);
  }, []);

  if (authError) return <Notice kind="error">{authError}</Notice>;
  if (authLoading || !userId) return <FullPageMessage>טוען…</FullPageMessage>;
  if (!profile || !data) {
    return loadError ? <Notice kind="error">{loadError}</Notice> : <FullPageMessage>טוען…</FullPageMessage>;
  }

  const currentUserId: string = userId;
  const currentData: LoadedDay = data;
  const today = new Date();
  const isToday = isSameDay(day, today);
  const age = profile.birth_date ? ageInYears(profile.birth_date, today) : null;
  const weightKg =
    currentData.latestWeightKg ?? (profile.start_weight_kg === null ? null : Number(profile.start_weight_kg));
  const energy = estimateEnergy(profile, weightKg, age);
  const summary = summarizeDay(currentData, energy ? { bmr: energy.bmr, baselineKcal: energy.baseline } : null);
  const timeline = buildTimeline(currentData, energy?.bmr ?? null);
  const balance = summary.balance;

  async function addWaterGlass() {
    setAddingWater(true);
    setActionError(null);
    try {
      await saveDrink(
        currentUserId,
        {
          drinkType: "מים",
          consumedAt: defaultEntryTime(day, new Date()).toISOString(),
          volumeMl: 250,
          caloriesKcal: 0,
          caffeineMg: null,
          hydrationMl: 250,
          notes: null,
        },
        null,
      );
      setReloadKey((key) => key + 1);
    } catch {
      setActionError("הוספת המים נכשלה. בדוק את החיבור ונסה שוב.");
    } finally {
      setAddingWater(false);
    }
  }

  function openEvent(event: TimelineEvent) {
    if (event.kind === "food") {
      const existing = currentData.foods.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "meal", existing });
    } else if (event.kind === "drink") {
      const existing = currentData.drinks.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "drink", existing });
    } else if (event.kind === "activity") {
      const existing = currentData.activities.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "activity", existing });
    } else {
      const existing = currentData.weights.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "weight", existing });
    }
  }

  let balanceHeadline = "";
  let balanceIcon = "";
  if (balance) {
    if (balance.status === "deficit") {
      balanceHeadline = `גירעון של ${formatNumber(Math.abs(balance.balanceKcal))} קק"ל`;
      balanceIcon = "▼";
    } else if (balance.status === "surplus") {
      balanceHeadline = `עודף של ${formatNumber(balance.balanceKcal)} קק"ל`;
      balanceIcon = "▲";
    } else {
      balanceHeadline = "איזון משוער";
      balanceIcon = "≈";
    }
  }

  return (
    <main className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">שלום{profile.display_name ? `, ${profile.display_name}` : ""}</h1>
        <Link
          href="/profile"
          className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          פרופיל ויעדים
        </Link>
      </header>

      <nav aria-label="בחירת יום" className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setDay((current) => addDays(current, -1))}
          aria-label="היום הקודם"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <span aria-hidden="true">▶</span>
        </button>
        <div className="text-center">
          <div className="font-semibold">{formatDayLabel(day, today)}</div>
          {!isToday ? (
            <button
              type="button"
              onClick={() => setDay(startOfDay(new Date()))}
              className="text-sm font-medium text-emerald-700 underline"
            >
              חזרה להיום
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setDay((current) => addDays(current, 1))}
          disabled={isToday}
          aria-label="היום הבא"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          <span aria-hidden="true">◀</span>
        </button>
      </nav>

      {loadError ? <Notice kind="error">{loadError}</Notice> : null}
      {actionError ? <Notice kind="error">{actionError}</Notice> : null}

      <div className={"space-y-4 transition-opacity " + (refreshing ? "opacity-60" : "")} aria-busy={refreshing}>
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-600">מאזן קלורי (הערכה)</h2>
          {balance && energy ? (
            <>
              <p className="mb-2 text-2xl font-bold">
                <span aria-hidden="true">{balanceIcon} </span>
                {balanceHeadline}
              </p>
              {!summary.hasFood ? (
                <div className="mb-2">
                  <Notice kind="info">עוד לא הוזן מזון ביום הזה, ולכן המאזן עדיין לא משקף את היום.</Notice>
                </div>
              ) : null}
              <dl className="divide-y divide-slate-100">
                <Row label="נצרך ממזון" value={`${formatNumber(summary.foodKcal)} קק"ל`} />
                <Row label="נצרך ממשקאות" value={`${formatNumber(summary.drinkKcal)} קק"ל`} />
                <Row label="סך הכול נצרך" value={`${formatNumber(balance.consumedKcal)} קק"ל`} strong />
                <Row label="הוצאה בסיסית, בלי אימונים" value={`${formatNumber(energy.baseline)} קק"ל`} />
                <Row label="אימונים (קלוריות פעילות)" value={`${formatNumber(summary.activity.activeKcal)} קק"ל`} />
                <Row label="סך הכול הוצאה" value={`${formatNumber(balance.burnedKcal)} קק"ל`} strong />
                <Row label="יעד צריכה ביום בלי אימון" value={`${formatNumber(energy.target.targetKcal)} קק"ל`} />
              </dl>
              {summary.activity.notSeparable > 0 ? (
                <div className="mt-2">
                  <Notice kind="info">
                    {summary.activity.notSeparable === 1
                      ? "פעילות אחת לא נספרה במאזן"
                      : `${summary.activity.notSeparable} פעילויות לא נספרו במאזן`}
                    . יש להן רק קלוריות כוללות בלי משך, ואי אפשר להפריד מהן את חלק המנוחה.
                  </Notice>
                </div>
              ) : null}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                ההוצאה הבסיסית מחושבת בנוסחת Mifflin-St Jeor לפי משקל של {weightKg} ק"ג, כפול רמת הפעילות היומיומית
                שבחרת. המספרים הם הערכה ולא מדידה.
              </p>
            </>
          ) : (
            <Notice kind="info">כדי לחשב מאזן חסרים פרטים בפרופיל: מין, תאריך לידה, גובה ומשקל.</Notice>
          )}
        </Card>

        <button
          type="button"
          onClick={() => setSheet({ kind: "ai" })}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-base font-bold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
        >
          <span aria-hidden="true" className="text-2xl leading-none">
            📷
          </span>
          צילום או תיאור ארוחה
        </button>

        <div className="grid grid-cols-4 gap-2">
          <ActionButton icon="🍽" label="מזון ידני" onClick={() => setSheet({ kind: "food", existing: null })} />
          <ActionButton icon="🥤" label="משקה" onClick={() => setSheet({ kind: "drink", existing: null })} />
          <ActionButton icon="🏃" label="פעילות" onClick={() => setSheet({ kind: "activity", existing: null })} />
          <ActionButton icon="⚖" label="משקל" onClick={() => setSheet({ kind: "weight", existing: null })} />
        </div>

        <Card className="space-y-4">
          <ProgressBar
            label="חלבון"
            value={summary.proteinG}
            goal={profile.daily_protein_goal_g === null ? null : Number(profile.daily_protein_goal_g)}
            unit="גרם"
          />
          <dl className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-slate-100 py-2">
              <dt className="text-xs text-slate-600">פחמימות</dt>
              <dd className="font-bold tabular-nums">{formatNumber(summary.carbsG)} גרם</dd>
            </div>
            <div className="rounded-xl bg-slate-100 py-2">
              <dt className="text-xs text-slate-600">שומן</dt>
              <dd className="font-bold tabular-nums">{formatNumber(summary.fatG)} גרם</dd>
            </div>
          </dl>
        </Card>

        <Card className="space-y-3">
          <ProgressBar label="שתייה" value={summary.hydrationMl} goal={Number(profile.daily_water_goal_ml)} unit={'מ"ל'} />
          {summary.caffeineMg > 0 ? (
            <p className="text-xs text-slate-500">קפאין היום: כ-{formatNumber(summary.caffeineMg)} מ"ג (הערכה)</p>
          ) : null}
          <button
            type="button"
            onClick={addWaterGlass}
            disabled={addingWater}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-sky-300 bg-sky-50 px-4 font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-60"
          >
            {addingWater ? "מוסיף…" : '+ כוס מים (250 מ"ל)'}
          </button>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">משקל אחרון</h2>
            <span className="font-bold tabular-nums">{weightKg === null ? "לא הוזן" : `${weightKg} ק"ג`}</span>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold">היום שלך</h2>
          {timeline.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              עוד אין רשומות ביום הזה. אפשר להוסיף מזון, משקה, פעילות או שקילה בכפתורים שלמעלה.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {timeline.map((event) => (
                <TimelineItem key={event.key} event={event} onOpen={() => openEvent(event)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {sheet ? (
        <Sheet title={sheetTitle(sheet)} onClose={closeSheet}>
          {sheet.kind === "ai" ? (
            <AnalyzeMeal userId={currentUserId} day={day} onDone={onSaved} />
          ) : sheet.kind === "meal" ? (
            <MealForm userId={currentUserId} day={day} existing={sheet.existing} draft={null} onDone={onSaved} />
          ) : sheet.kind === "food" ? (
            <FoodForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          ) : sheet.kind === "drink" ? (
            <DrinkForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          ) : sheet.kind === "activity" ? (
            <ActivityForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          ) : (
            <WeightForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          )}
        </Sheet>
      ) : null}
    </main>
  );
}
