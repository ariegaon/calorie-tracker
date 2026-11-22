"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { BottomNav } from "@/components/BottomNav";
import { Button, Card, FullPageMessage, Notice, TextArea } from "@/components/ui";
import { loadProfile, saveAiConsent } from "@/lib/profile";
import { askQuestion, clearQuestions, loadInsights, loadQuestions, type QuestionRow } from "@/lib/insights/data";
import { EXAMPLE_QUESTIONS } from "@/lib/insights/questions";

export default function AskPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;

  const [consent, setConsent] = useState<string | null | undefined>(undefined);
  const [history, setHistory] = useState<QuestionRow[]>([]);
  const [question, setQuestion] = useState("");
  const [insightId, setInsightId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    const id = userId;
    let cancelled = false;
    // "Tell me more" from an insight arrives as ?about=<insight id>.
    const about = new URLSearchParams(window.location.search).get("about");
    Promise.all([loadProfile(id), loadQuestions(id), about ? loadInsights(id) : Promise.resolve([])])
      .then(([profile, questions, insights]) => {
        if (cancelled) return;
        setConsent(profile?.ai_insights_consent_at ?? null);
        setHistory(questions);
        const insight = about ? insights.find((row) => row.id === about) : undefined;
        if (insight) {
          setInsightId(insight.id);
          setQuestion(`ספר לי עוד על התובנה "${insight.title}". למה זה קורה אצלי, ומה הכי כדאי לעשות?`);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("לא הצלחנו לטעון. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [loading, userId, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, busy]);

  if (loading || !userId || consent === undefined) {
    return loadError ? <Notice kind="error">{loadError}</Notice> : <FullPageMessage>טוען…</FullPageMessage>;
  }
  const currentUserId: string = userId;

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      setConsent(await saveAiConsent(currentUserId, true));
    } catch {
      setError("השמירה נכשלה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function send(event?: FormEvent<HTMLFormElement>, text?: string) {
    event?.preventDefault();
    const asked = (text ?? question).trim();
    if (asked.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await askQuestion(
        currentUserId,
        asked,
        history.map((row) => ({ question: row.question, answer: row.answer })),
        insightId,
      );
      setHistory((current) => [
        ...current,
        { id: `local-${Date.now()}`, created_at: new Date().toISOString(), question: asked, answer },
      ]);
      setQuestion("");
      setInsightId(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "לא התקבלה תשובה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    setError(null);
    try {
      await clearQuestions(currentUserId);
      setHistory([]);
    } catch {
      setError("המחיקה נכשלה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-4 pb-24">
      <header className="space-y-1">
        <Link href="/insights" className="text-sm font-medium text-emerald-700">
          <span aria-hidden="true">→ </span>תובנות
        </Link>
        <h1 className="text-2xl font-bold">שאל את הנתונים</h1>
        <p className="text-sm text-slate-600">שאלות על האוכל, האימונים והמשקל שלך מהחודשיים האחרונים.</p>
      </header>

      {consent === null ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">לפני השאלה הראשונה</h2>
          <p className="text-sm leading-relaxed text-slate-700">
            כדי לענות, נשלח ל-OpenAI סיכום של הנתונים שלך מהחודשיים האחרונים: קלוריות לפי יום וארוחה, מאכלים שחוזרים,
            שקילות ותנאיהן, אימונים והיעדים שקבעת. בלי שם, מייל או פרטים מזהים אחרים.
          </p>
          <p className="text-sm leading-relaxed text-slate-700">
            השאלות והתשובות נשמרות בחשבון שלך ואפשר למחוק אותן בכל עת. באישור הזה גם תובנת השבוע תנוסח בעזרת AI. אפשר לבטל
            את האישור בהגדרות ← חשבון.
          </p>
          <Link href="/privacy" className="block text-sm font-medium text-emerald-700 underline">
            מדיניות הפרטיות
          </Link>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Button type="button" disabled={busy} onClick={() => void agree()}>
            {busy ? "שומר…" : "מאשר, אפשר להתחיל"}
          </Button>
        </Card>
      ) : (
        <>
          {history.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">אפשר להתחיל משאלה כזו:</p>
              <ul className="flex flex-wrap gap-2">
                {EXAMPLE_QUESTIONS.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void send(undefined, example)}
                      className="min-h-10 rounded-2xl border border-slate-300 bg-white px-3 py-1.5 text-start text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="space-y-4">
              {history.map((row) => (
                <li key={row.id} className="space-y-2">
                  <p className="ms-8 rounded-2xl bg-emerald-600 px-3 py-2 text-white">{row.question}</p>
                  <div className="me-4 whitespace-pre-line rounded-2xl border border-slate-200 bg-white px-3 py-2 leading-relaxed text-slate-800 shadow-sm">
                    {row.answer}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {busy ? (
            <p className="text-sm text-slate-600" role="status">
              מנתח את הנתונים שלך…
            </p>
          ) : null}
          <div ref={endRef} />

          {error ? <Notice kind="error">{error}</Notice> : null}

          <form onSubmit={(event) => void send(event)} className="space-y-2">
            <TextArea
              rows={3}
              maxLength={500}
              aria-label="השאלה שלך"
              placeholder="למשל: באילו ימים אני חורג מהיעד, ולמה?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button type="submit" disabled={busy || question.trim().length < 2}>
              {busy ? "רגע…" : "שליחה"}
            </Button>
          </form>

          <p className="text-xs leading-relaxed text-slate-500">
            התשובות מבוססות על הנתונים שרשמת, ומחושבות בעזרת AI. הן הערכה, לא ייעוץ רפואי. עד 10 שאלות ביום.
          </p>
          {history.length > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearAll()}
              className="text-sm text-slate-500 underline disabled:opacity-50"
            >
              מחיקת השאלות והתשובות
            </button>
          ) : null}
        </>
      )}
      <BottomNav />
    </main>
  );
}
