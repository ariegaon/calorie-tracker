"use client";

import { useState, type ChangeEvent } from "react";
import { Button, Field, Notice, TextArea } from "@/components/ui";
import { MealForm, type AiMealDraft } from "@/components/forms/MealForm";
import { getSupabase } from "@/lib/supabase/client";
import { fileToResizedDataUrl } from "@/lib/ai/image";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/ai/meal";

const pickerClass =
  "flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-3 " +
  "text-center text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-within:ring-2 focus-within:ring-emerald-600/50";

/**
 * Step 1: photo and/or description, sent to the server for analysis.
 * Step 2: the estimate is shown for correction and saved only after the user confirms.
 */
export function AnalyzeMeal({ userId, day, onDone }: { userId: string; day: Date; onDone: () => void }) {
  const [description, setDescription] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiMealDraft | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);

  async function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      setImageDataUrl(await fileToResizedDataUrl(file));
    } catch {
      setError("לא הצלחנו לקרוא את התמונה. נסה תמונה אחרת.");
    }
  }

  async function analyze() {
    setError(null);
    if (description.trim() === "" && !imageDataUrl) {
      setError("יש לצלם את הארוחה או לתאר אותה במילים.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("ההתחברות פגה. התחבר מחדש ונסה שוב.");
        return;
      }
      const response = await fetch("/api/analyze-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: description.trim(), imageDataUrl }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        analysis?: unknown;
        source?: unknown;
      } | null;
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "הניתוח נכשל. נסה שוב.");
        return;
      }
      // The server already checked the model's answer; the shape is checked again before it is used.
      const raw = body?.analysis as Record<string, unknown> | undefined;
      const analysis =
        raw && Array.isArray(raw.items) && typeof raw.isFood === "boolean"
          ? (raw as unknown as AiMealDraft["analysis"])
          : null;
      if (!analysis) {
        setError("התקבלה תשובה לא צפויה. נסה שוב.");
        return;
      }
      if (!analysis.isFood || analysis.items.length === 0) {
        setError("לא זוהה אוכל או משקה. נסה תמונה ברורה יותר או הוסף תיאור.");
        return;
      }
      setClarification(analysis.clarification);
      setDraft({ analysis, source: body?.source === "ai_photo" ? "ai_photo" : "ai_text" });
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className="space-y-4">
        {clarification ? <Notice kind="info">שאלה מהמודל: {clarification}</Notice> : null}
        <MealForm userId={userId} day={day} existing={null} draft={draft} onDone={onDone} />
        <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
          חזרה ושינוי התיאור או התמונה
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className={pickerClass}>
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPickImage} disabled={busy} />
          📷 צילום ארוחה
        </label>
        <label className={pickerClass}>
          <input type="file" accept="image/*" className="sr-only" onChange={onPickImage} disabled={busy} />
          🖼 בחירה מהגלריה
        </label>
      </div>

      {imageDataUrl ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageDataUrl} alt="התמונה שנבחרה" className="max-h-64 w-full rounded-2xl object-cover" />
          <Button type="button" variant="dangerGhost" onClick={() => setImageDataUrl(null)} disabled={busy}>
            הסרת התמונה
          </Button>
        </div>
      ) : null}

      <Field
        label="תיאור (לא חובה כשיש תמונה)"
        htmlFor="analyze-description"
        hint="פירוט של כמויות ואופן הכנה משפר מאוד את הדיוק. למשל: 200 גרם חזה עוף צלוי, כוס אורז, כף שמן זית."
      >
        <TextArea
          id="analyze-description"
          rows={3}
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <Button type="button" onClick={analyze} disabled={busy}>
        {busy ? "מנתח… זה לוקח עד חצי דקה" : "ניתוח הארוחה"}
      </Button>

      <p className="text-xs leading-relaxed text-slate-500">
        התמונה והתיאור נשלחים ל-OpenAI לצורך הניתוח בלבד, בלי פרטים מזהים. התוצאה היא הערכה: תוכל לתקן אותה לפני
        השמירה, ושום דבר לא נשמר בלי אישורך. התמונה עצמה לא נשמרת.
      </p>
    </div>
  );
}
