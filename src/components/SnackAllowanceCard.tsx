"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { profileEnergy } from "@/lib/energy-profile";
import { saveSnackAllowance, type ProfileRow, type SnackAllowanceSetting } from "@/lib/profile";
import { SNACK_ALLOWANCE_LIMIT_KCAL, suggestedSnackAllowance } from "@/lib/calculations/goal";
import { parseNumber } from "@/lib/validation/profile";
import { Button, Card, Field, Notice, TextArea, TextInput } from "@/components/ui";

type Mode = "suggested" | "manual" | "ai";

const SOURCE_LABEL: Record<NonNullable<SnackAllowanceSetting["source"]>, string> = {
  suggested: "לפי הצעת האפליקציה",
  manual: "מספר שקבעת",
  ai: "לפי התיאור שלך",
};

type Saved = Pick<ProfileRow, "snack_allowance_kcal" | "snack_allowance_source" | "snack_allowance_note">;

/**
 * A fixed daily allowance for snacks that are never logged. It counts as eaten on every logged day,
 * is always shown as an estimate, and can be skipped for a single day from the home screen.
 */
export function SnackAllowanceCard({
  userId,
  profile,
  onSaved,
}: {
  userId: string;
  profile: ProfileRow;
  onSaved: (saved: Saved) => void;
}) {
  const current = profile.snack_allowance_kcal ?? 0;
  const enabled = current > 0;
  const energy = profileEnergy(
    profile,
    profile.start_weight_kg === null ? null : Number(profile.start_weight_kg),
    new Date(),
    0,
  );
  const suggestion = energy ? suggestedSnackAllowance(energy.target.targetKcal) : 120;

  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>(profile.snack_allowance_source ?? "suggested");
  const [manual, setManual] = useState(enabled && profile.snack_allowance_source === "manual" ? String(current) : "");
  const [description, setDescription] = useState(profile.snack_allowance_note ?? "");
  const [aiKcal, setAiKcal] = useState<number | null>(
    profile.snack_allowance_source === "ai" && enabled ? current : null,
  );
  const [aiItems, setAiItems] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function persist(setting: SnackAllowanceSetting) {
    setBusy(true);
    setError(null);
    try {
      await saveSnackAllowance(userId, setting);
      const off = setting.kcal === null || setting.kcal <= 0;
      onSaved({
        snack_allowance_kcal: off ? null : Math.round(setting.kcal as number),
        snack_allowance_source: off ? null : setting.source,
        snack_allowance_note: off ? null : setting.note,
      });
      setEditing(false);
      setNotice(off ? "התוספת כובתה." : `נשמר: ${Math.round(setting.kcal as number)} קק"ל ביום.`);
    } catch {
      setError("השמירה נכשלה. בדוק את החיבור ונסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function estimateWithAi() {
    setError(null);
    const text = description.trim();
    if (text.length < 3) {
      setError("כתוב מה אתה נוהג לנשנש ביום רגיל, למשל: חופן בייגלה ושתי עוגיות.");
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
        body: JSON.stringify({ description: `נשנושים קטנים ביום רגיל, בסך הכול ליום אחד: ${text}` }),
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown; analysis?: unknown } | null;
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "ההערכה נכשלה. נסה שוב.");
        return;
      }
      const analysis = body?.analysis as
        | { isFood?: unknown; items?: { name?: unknown; caloriesKcal?: unknown }[] }
        | undefined;
      const items = Array.isArray(analysis?.items) ? analysis.items : [];
      const total = items.reduce((sum, item) => sum + (typeof item.caloriesKcal === "number" ? item.caloriesKcal : 0), 0);
      if (analysis?.isFood !== true || items.length === 0 || total <= 0) {
        setError("לא הצלחנו להעריך מהתיאור. נסה לפרט מה ובערך כמה.");
        return;
      }
      setAiKcal(Math.min(SNACK_ALLOWANCE_LIMIT_KCAL, Math.round(total / 10) * 10));
      setAiItems(
        items
          .map((item) => `${String(item.name ?? "")} (${Math.round(Number(item.caloriesKcal) || 0)})`)
          .join(", "),
      );
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור ונסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (mode === "suggested") {
      void persist({ kcal: suggestion, source: "suggested", note: null });
      return;
    }
    if (mode === "manual") {
      const value = parseNumber(manual);
      if (value === null || value < 10 || value > SNACK_ALLOWANCE_LIMIT_KCAL) {
        setError(`יש להזין מספר בין 10 ל-${SNACK_ALLOWANCE_LIMIT_KCAL}`);
        return;
      }
      void persist({ kcal: value, source: "manual", note: null });
      return;
    }
    if (aiKcal === null) {
      setError('קודם לחץ על "הערכה" כדי לקבל מספר מהתיאור.');
      return;
    }
    void persist({ kcal: aiKcal, source: "ai", note: description.trim().slice(0, 300) });
  }

  const option = (value: Mode, title: string, detail: string) => (
    <label
      className={
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 " +
        (mode === value ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white")
      }
    >
      <input
        type="radio"
        name="snack-mode"
        className="mt-1 h-4 w-4 accent-emerald-600"
        checked={mode === value}
        onChange={() => {
          setMode(value);
          setError(null);
        }}
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-slate-600">{detail}</span>
      </span>
    </label>
  );

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">נשנושים שלא נרשמו</h2>
      <p className="text-sm text-slate-600">
        תוספת קבועה ליום לביסים קטנים שלא נרשמים: בייגלה, עוגייה, טעימה מהסיר. היא נספרת כאילו נאכלה, מסומנת כהערכה,
        ונוספת רק בימים שבהם רשמת אוכל. ביום שבו רשמת הכול אפשר לבטל אותה ממסך הבית.
      </p>

      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      {!editing ? (
        <>
          <p className="font-medium">
            {enabled
              ? `פעיל: ${current} קק"ל ביום (${SOURCE_LABEL[profile.snack_allowance_source ?? "manual"]})`
              : "כבוי"}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditing(true);
              setNotice(null);
            }}
          >
            {enabled ? "שינוי" : "הפעלה"}
          </Button>
          {enabled ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void persist({ kcal: null, source: null, note: null })}
            >
              כיבוי התוספת
            </Button>
          ) : null}
        </>
      ) : (
        <div className="space-y-3">
          {option("suggested", `הצעה של האפליקציה: ${suggestion} קק"ל`, "כ-7% מיעד הצריכה היומי שלך.")}
          {option("manual", "מספר שאקבע", "אם אתה יודע בערך כמה אתה מנשנש.")}
          {mode === "manual" ? (
            <Field label={'קק"ל ביום'} htmlFor="snack-manual">
              <TextInput
                id="snack-manual"
                inputMode="numeric"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </Field>
          ) : null}
          {option("ai", "לתאר מה אני נוהג לנשנש", "ה-AI מעריך פעם אחת, והמספר נשמר כקבוע.")}
          {mode === "ai" ? (
            <div className="space-y-2">
              <Field label="מה אתה מנשנש ביום רגיל?" htmlFor="snack-description">
                <TextArea
                  id="snack-description"
                  rows={3}
                  maxLength={300}
                  placeholder="למשל: חופן בייגלה, עוגייה או שתיים, וקצת מהצלחת של הילדים"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setAiKcal(null);
                    setAiItems(null);
                  }}
                />
              </Field>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void estimateWithAi()}>
                {busy ? "מעריך…" : "הערכה"}
              </Button>
              {aiKcal !== null ? (
                <Notice kind="info">
                  הערכה: {aiKcal} קק"ל ביום{aiItems ? ` — ${aiItems}` : ""}
                </Notice>
              ) : null}
            </div>
          ) : null}
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? "שומר…" : "שמירה"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            ביטול
          </Button>
        </div>
      )}
    </Card>
  );
}
