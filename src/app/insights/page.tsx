"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { Card, FullPageMessage, Notice } from "@/components/ui";
import { INSIGHT_WINDOW_DAYS, insightReadiness, MIN_LOGGED_DAYS, type Readiness } from "@/lib/insights/readiness";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    loadReadiness(userId)
      .then((result) => {
        if (!cancelled) setReadiness(result);
      })
      .catch(() => {
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

      {readiness && readiness.ready ? (
        <Card className="space-y-2">
          <h2 className="font-semibold">יש מספיק נתונים</h2>
          <p className="text-sm text-slate-700">
            {readiness.loggedDays} ימי רישום ו-{readiness.weighIns} ימי שקילה בחודשיים האחרונים. התובנות יופיעו כאן בקרוב.
          </p>
        </Card>
      ) : null}

      <Link href="/reports" className="block text-sm font-medium text-emerald-700 underline">
        לדוחות ולסיכומים
      </Link>

      <BottomNav />
    </main>
  );
}
