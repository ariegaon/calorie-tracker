"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { Card, FullPageMessage, Notice } from "@/components/ui";
import { INSIGHT_WINDOW_DAYS, insightReadiness, MIN_LOGGED_DAYS, type Readiness } from "@/lib/insights/readiness";
import {
  loadInsights,
  markInsightsSeen,
  maybeGenerateWeeklyInsight,
  setInsightFeedback,
  type GenerationResult,
  type InsightRow,
} from "@/lib/insights/data";

async function loadReadiness(userId: string): Promise<Readiness> {
  const since = new Date(Date.now() - INSIGHT_WINDOW_DAYS * 86_400_000).toISOString();
  const supabase = getSupabase();
  const [foods, weights] = await Promise.all([
    supabase.from("food_entries").select("consumed_at").eq("user_id", userId).gte("consumed_at", since).limit(5000),
    supabase.from("weight_logs").select("measured_at").eq("user_id", userId).gte("measured_at", since).limit(2000),
  ]);
  if (foods.error) throw new Error(foods.error.message);
  if (weights.error) throw new Error(weights.error.message);
  return insightReadiness(
    ((foods.data ?? []) as { consumed_at: string }[]).map((row) => row.consumed_at),
    ((weights.data ?? []) as { measured_at: string }[]).map((row) => row.measured_at),
  );
}

export default function InsightsPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [insights, setInsights] = useState<InsightRow[] | null>(null);
  const [generation, setGeneration] = useState<GenerationResult | "running" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    const id = userId;
    async function load() {
      const [ready, list] = await Promise.all([loadReadiness(id), loadInsights(id)]);
      if (cancelled) return;
      setReadiness(ready);
      setInsights(list);
      const unseen = list.filter((row) => row.seen_at === null).map((row) => row.id);
      void markInsightsSeen(id, unseen).catch(() => undefined);

      // This week's insight, if one is due: the analysis runs here and takes a few seconds.
      if (!ready.ready) return;
      setGeneration("running");
      const result = await maybeGenerateWeeklyInsight(id);
      if (cancelled) return;
      setGeneration(result);
      if (result === "created") {
        const fresh = await loadInsights(id);
        if (cancelled) return;
        setInsights(fresh);
        void markInsightsSeen(
          id,
          fresh.filter((row) => row.seen_at === null).map((row) => row.id),
        ).catch(() => undefined);
      }
    }
    load().catch(() => {
      if (!cancelled) setError("לא הצלחנו לטעון את הנתונים. בדוק את החיבור ונסה לרענן.");
    });
    return () => {
      cancelled = true;
    };
  }, [loading, userId, router]);

  if (loading || !userId) return <FullPageMessage>טוען…</FullPageMessage>;

  return (
    <main className="space-y-5 pb-20">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">תובנות</h1>
        <p className="text-sm text-slate-600">
          דפוסים בנתונים שלך שקשה לראות לבד, ומה כדאי לעשות איתם. מוצגים רק ממצאים שיש להם מספיק ראיות.
        </p>
      </header>

      {error ? <Notice kind="error">{error}</Notice> : null}

      {readiness === null && !error ? <p className="text-slate-600">טוען…</p> : null}

      {readiness && !readiness.ready ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">לומדים אותך</h2>
          <p className="text-sm text-slate-700">
            בחודשיים האחרונים יש {readiness.loggedDays} ימים עם רישום אוכל. התובנות הראשונות יופיעו אחרי{" "}
            {MIN_LOGGED_DAYS} ימי רישום, עוד {readiness.daysToGo} {readiness.daysToGo === 1 ? "יום" : "ימים"}.
          </p>
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={MIN_LOGGED_DAYS}
            aria-valuenow={readiness.loggedDays}
            aria-label="ימי רישום"
          >
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, (readiness.loggedDays / MIN_LOGGED_DAYS) * 100)}%` }}
            />
          </div>
          <p className="text-sm text-slate-600">
            מה עוזר: לרשום את כל הארוחות, גם בדיעבד, ולהישקל כמה פעמים בשבוע באותם תנאים.
          </p>
        </Card>
      ) : null}

      {generation === "running" ? (
        <p className="text-sm text-slate-600" role="status">
          מנתח את הנתונים שלך…
        </p>
      ) : null}

      {readiness?.ready && insights && insights.length === 0 && generation !== "running" ? (
        <Card className="space-y-2">
          <h2 className="font-semibold">עוד אין תובנה</h2>
          <p className="text-sm text-slate-700">
            {generation === "nothing_found"
              ? "בדקנו את הנתונים מהחודשיים האחרונים ולא מצאנו דפוס חזק מספיק כדי להציג. עדיף שתיקה מתובנה בינונית. נבדוק שוב בעוד יום-יומיים."
              : generation === "failed"
                ? "הניתוח לא הצליח הפעם. ננסה שוב כשתחזור לכאן."
                : `${readiness.loggedDays} ימי רישום בחודשיים האחרונים. התובנה הראשונה תופיע כאן.`}
          </p>
        </Card>
      ) : null}

      {insights && insights.length > 0 ? (
        <ul className="space-y-4">
          {insights.map((insight, index) => (
            <li key={insight.id}>
              <InsightCard
                insight={insight}
                latest={index === 0}
                onFeedback={(feedback) =>
                  setInsights((current) =>
                    current ? current.map((row) => (row.id === insight.id ? { ...row, feedback } : row)) : current,
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      {insights && insights.length > 0 ? (
        <p className="text-xs leading-relaxed text-slate-500">
          המספרים בתובנות מחושבים באפליקציה מהנתונים שלך. הניסוח נעשה בעזרת AI, שמקבל רק את התוצאות המחושבות. אלה הערכות,
          לא ייעוץ רפואי.
        </p>
      ) : null}

      <Link href="/reports" className="block text-sm font-medium text-emerald-700 underline">
        לדוחות ולסיכומים
      </Link>

      <BottomNav />
    </main>
  );
}

const dateFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" });

function InsightCard({
  insight,
  latest,
  onFeedback,
}: {
  insight: InsightRow;
  latest: boolean;
  onFeedback: (feedback: InsightRow["feedback"]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function give(feedback: "useful" | "not_relevant") {
    const next = insight.feedback === feedback ? null : feedback;
    setBusy(true);
    setError(null);
    try {
      await setInsightFeedback(insight.id, next);
      onFeedback(next);
    } catch {
      setError("השמירה נכשלה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  const choice = (value: "useful" | "not_relevant", label: string) => (
    <button
      type="button"
      disabled={busy}
      aria-pressed={insight.feedback === value}
      onClick={() => void give(value)}
      className={
        "min-h-10 rounded-full border px-4 text-sm font-medium disabled:opacity-60 " +
        (insight.feedback === value
          ? "border-emerald-600 bg-emerald-50 text-emerald-800"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
      }
    >
      {label}
    </button>
  );

  return (
    <Card className={"space-y-3 " + (latest ? "border-emerald-300" : "")}>
      <p className="text-xs font-medium text-slate-500">
        {latest ? "תובנת השבוע · " : ""}
        {dateFormat.format(new Date(insight.created_at))}
      </p>
      <h2 className="text-lg font-bold leading-snug">{insight.title}</h2>
      <p className="leading-relaxed text-slate-800">{insight.body}</p>
      {insight.action ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="font-semibold">הצעד הבא: </span>
          {insight.action}
        </p>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        {choice("useful", "מעניין")}
        {choice("not_relevant", "לא רלוונטי")}
      </div>
      {insight.feedback === "not_relevant" ? (
        <p className="text-xs text-slate-500">תובנות מהסוג הזה לא יוצגו לך יותר.</p>
      ) : null}
    </Card>
  );
}
