"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { ageInYears } from "@/lib/validation/profile";
import { baselineExpenditure, bmrMifflinStJeor } from "@/lib/calculations/energy";
import type { WeightRow } from "@/lib/day/entries";
import type { DayData } from "@/lib/day/summary";
import { loadRangeDays, type RangeDay } from "@/lib/reports/data";
import { EXPORT_HEADERS, buildReport, exportRows, toCsv } from "@/lib/reports/report";
import { loadWeights } from "@/lib/weight/data";
import { dailyWeights, dateOfDay, dayIndex, movingAverage } from "@/lib/weight/trend";
import { Button, Card, FullPageMessage, Notice } from "@/components/ui";
import { BalanceChart } from "@/components/BalanceChart";
import { BottomNav } from "@/components/BottomNav";

type Period = "week" | "month";

const rangeFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" });
const monthFormat = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });

/** First and last day of the week (Sunday to Saturday) or month that is `offset` periods from today. */
function periodRange(period: Period, offset: number, now: Date): { first: number; last: number; label: string } {
  if (period === "week") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { first: dayIndex(start), last: dayIndex(end), label: `${rangeFormat.format(start)} עד ${rangeFormat.format(end)}` };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { first: dayIndex(start), last: dayIndex(end), label: monthFormat.format(start) };
}

function kcal(value: number | null): string {
  return value === null ? "אין נתונים" : `${Math.round(value).toLocaleString("he-IL")} קק"ל`;
}

function balanceText(value: number | null): string {
  if (value === null) return "אין נתונים";
  if (Math.abs(value) < 50) return "איזון משוער";
  return `${value < 0 ? "גירעון של" : "עודף של"} ${Math.round(Math.abs(value)).toLocaleString("he-IL")} קק"ל`;
}

function changeText(value: number | null): string {
  if (value === null) return "אין מספיק שקילות";
  if (Math.abs(value) < 0.05) return "ללא שינוי";
  return `${value > 0 ? "עלייה של" : "ירידה של"} ${Math.abs(value).toFixed(1)} ק"ג`;
}

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} דק'`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} שעות`;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const userId = session?.user.id ?? null;

  const [period, setPeriod] = useState<Period>("week");
  const [offset, setOffset] = useState(0);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [weights, setWeights] = useState<WeightRow[]>([]);
  const [days, setDays] = useState<RangeDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const range = useMemo(() => periodRange(period, offset, new Date()), [period, offset]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    Promise.all([loadProfile(userId), loadWeights(userId)])
      .then(([profileRow, weightRows]) => {
        if (cancelled) return;
        if (!profileRow?.onboarding_completed_at) {
          router.replace("/profile");
          return;
        }
        setProfile(profileRow);
        setWeights(weightRows);
      })
      .catch(() => {
        if (!cancelled) setLoadError("לא הצלחנו לטעון את הנתונים. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, router]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    loadRangeDays(userId, range.first, range.last)
      .then((loaded) => {
        if (cancelled) return;
        setDays(loaded);
        setLoadError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("לא הצלחנו לטעון את הדוח. בדוק את החיבור ונסה שוב.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, range.first, range.last]);

  const report = useMemo(() => {
    if (!profile || !days) return null;
    const now = new Date();
    const today = dayIndex(now);
    // Future days of the current period are left out, so they do not count as missing.
    const elapsed = days.filter((d) => d.day <= today);

    const daily = dailyWeights(weights.map((row) => ({ at: row.measured_at, weightKg: Number(row.weight_kg) })));
    const latest = daily.length > 0 ? daily[daily.length - 1].weightKg : null;
    const weightKg = latest ?? (profile.start_weight_kg === null ? null : Number(profile.start_weight_kg));
    const age = profile.birth_date ? ageInYears(profile.birth_date, now) : null;
    const sex = profile.sex_for_bmr;
    let energy: { bmr: number; baselineKcal: number } | null = null;
    if (sex && age !== null && age > 0 && profile.height_cm !== null && weightKg !== null) {
      const bmr = bmrMifflinStJeor({ sex, weightKg, heightCm: Number(profile.height_cm), ageYears: age });
      energy = { bmr, baselineKcal: baselineExpenditure(bmr, Number(profile.activity_factor)) };
    }

    return buildReport({
      days: elapsed,
      energy,
      proteinGoalG: profile.daily_protein_goal_g === null ? null : Number(profile.daily_protein_goal_g),
      waterGoalMl: Number(profile.daily_water_goal_ml),
      weightAverage: movingAverage(daily),
    });
  }, [profile, days, weights]);

  function exportCsv() {
    setExportError(null);
    try {
      const data = (days ?? []).map((d) => d.data).filter((d): d is DayData => d !== null);
      const rows = exportRows(data);
      if (rows.length === 0) {
        setExportError("אין רשומות לייצוא בתקופה הזאת.");
        return;
      }
      const blob = new Blob([toCsv(EXPORT_HEADERS, rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = (day: number) => {
        const d = dateOfDay(day);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      };
      link.href = url;
      link.download = `calorie-tracker-${stamp(range.first)}-${stamp(range.last)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("הייצוא נכשל. נסה שוב.");
    }
  }

  if (authError) return <Notice kind="error">{authError}</Notice>;
  if (authLoading || !userId) return <FullPageMessage>טוען…</FullPageMessage>;
  if (!profile || !report) {
    return loadError ? <Notice kind="error">{loadError}</Notice> : <FullPageMessage>טוען…</FullPageMessage>;
  }

  return (
    <main className="space-y-4 pb-20">
      <h1 className="text-2xl font-bold">דוחות</h1>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="סוג הדוח">
        {(["week", "month"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={period === key}
            onClick={() => {
              setPeriod(key);
              setOffset(0);
            }}
            className={
              "min-h-11 rounded-xl text-sm font-semibold " +
              (period === key ? "bg-slate-800 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100")
            }
          >
            {key === "week" ? "שבועי" : "חודשי"}
          </button>
        ))}
      </div>

      <nav aria-label="בחירת תקופה" className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOffset((value) => value - 1)}
          aria-label="התקופה הקודמת"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <span aria-hidden="true">▶</span>
        </button>
        <div className="text-center font-semibold">{range.label}</div>
        <button
          type="button"
          onClick={() => setOffset((value) => Math.min(0, value + 1))}
          disabled={offset >= 0}
          aria-label="התקופה הבאה"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          <span aria-hidden="true">◀</span>
        </button>
      </nav>

      {loadError ? <Notice kind="error">{loadError}</Notice> : null}

      <div className={"space-y-4 transition-opacity " + (loading ? "opacity-60" : "")} aria-busy={loading}>
        {report.documentedDays === 0 ? (
          <Notice kind="info">אין ימים עם רישום מזון בתקופה הזאת, ולכן אין ממוצעים להציג.</Notice>
        ) : null}

        <Card>
          <h2 className="font-semibold">קלוריות ומאזן (הערכה)</h2>
          <dl className="mt-1 divide-y divide-slate-100">
            <Line label="ימים עם רישום מזון" value={`${report.documentedDays} מתוך ${report.totalDays}`} />
            <Line label="צריכה יומית ממוצעת" value={kcal(report.averageConsumedKcal)} />
            <Line label="הוצאה יומית ממוצעת" value={kcal(report.averageBurnedKcal)} />
            <Line label="מאזן יומי ממוצע" value={balanceText(report.averageBalanceKcal)} />
            <Line label="מאזן מצטבר" value={report.documentedDays > 0 ? balanceText(report.cumulativeBalanceKcal) : "אין נתונים"} />
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            הממוצעים מחושבים רק על ימים שנרשם בהם מזון. ההוצאה היא הערכה לפי הפרופיל והמשקל הנוכחי.
          </p>
        </Card>

        {report.totalDays > 0 ? (
          <Card>
            <h2 className="mb-2 font-semibold">צריכה מול הוצאה, לפי יום</h2>
            <BalanceChart days={report.perDay} />
          </Card>
        ) : null}

        <Card>
          <h2 className="font-semibold">משקל</h2>
          <dl className="mt-1 divide-y divide-slate-100">
            <Line label="שינוי בפועל (ממוצע נע)" value={changeText(report.weightChangeKg)} />
            <Line
              label="שינוי תיאורטי לפי הקלוריות"
              value={report.documentedDays > 0 && report.averageBalanceKcal !== null ? changeText(report.theoreticalChangeKg) : "אין נתונים"}
            />
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            התיאורטי מניח 7,700 קק"ל לק"ג ומתבסס רק על הימים המתועדים, ולכן פער בין השניים צפוי.
          </p>
        </Card>

        <Card>
          <h2 className="font-semibold">יעדים</h2>
          <dl className="mt-1 divide-y divide-slate-100">
            <Line label="חלבון יומי ממוצע" value={report.averageProteinG === null ? "אין נתונים" : `${Math.round(report.averageProteinG)} גרם`} />
            <Line
              label="ימים שעמדו ביעד החלבון"
              value={report.proteinGoalDays === null ? "לא הוגדר יעד" : `${report.proteinGoalDays} מתוך ${report.documentedDays}`}
            />
            <Line label="ימים שעמדו ביעד השתייה" value={`${report.waterGoalDays} מתוך ${report.totalDays}`} />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold">פעילות</h2>
          {report.activityCount === 0 ? (
            <p className="mt-2 text-sm text-slate-600">לא נרשמה פעילות בתקופה הזאת.</p>
          ) : (
            <>
              <dl className="mt-1 divide-y divide-slate-100">
                <Line label="מספר אימונים" value={String(report.activityCount)} />
                <Line label="זמן אימון כולל" value={duration(report.activitySeconds)} />
                <Line label="קלוריות פעילות" value={kcal(report.activeKcal)} />
              </dl>
              <h3 className="mt-3 text-sm font-semibold text-slate-700">לפי סוג</h3>
              <ul className="divide-y divide-slate-100 text-sm">
                {report.byActivityType.map((item) => (
                  <li key={item.type} className="flex items-baseline justify-between gap-3 py-2">
                    <span>
                      {item.type} <span className="text-slate-500">× {item.count}</span>
                    </span>
                    <span className="tabular-nums text-slate-700">
                      {duration(item.seconds)} · {Math.round(item.activeKcal).toLocaleString("he-IL")} קק"ל
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">ייצוא נתונים</h2>
          <p className="text-sm text-slate-600">
            קובץ CSV עם כל הרשומות של התקופה שמוצגת: מזון, משקאות, פעילויות ושקילות. נפתח ב-Excel וב-Google Sheets.
          </p>
          {exportError ? <Notice kind="error">{exportError}</Notice> : null}
          <Button type="button" variant="secondary" onClick={exportCsv}>
            הורדת CSV
          </Button>
        </Card>
      </div>

      <BottomNav />
    </main>
  );
}
