"use client";

// Protein, fat and carbohydrate goals in the profile form: each follows the recommendation or a value of the user's own.

import { useState } from "react";
import type { MacroTargets } from "@/lib/calculations/macros";
import type { ProfileErrors, ProfileForm } from "@/lib/validation/profile";
import { TextInput } from "@/components/ui";

type Key = "proteinGoalG" | "fatGoalG" | "carbsGoalG";

function fmt(value: number): string {
  return Math.round(value).toLocaleString("he-IL");
}

export function MacroGoalsFields({
  form,
  errors,
  macros,
  onChange,
}: {
  form: ProfileForm;
  errors: ProfileErrors;
  /** The recommendation for the values in the form; null until the details it needs are filled in. */
  macros: MacroTargets | null;
  onChange: (key: Key, value: string) => void;
}) {
  const basis = macros?.proteinBasis;
  const rec = macros?.recommended;
  const rows: { key: Key; label: string; recommendation: string | null; suggested: number | null }[] = [
    {
      key: "proteinGoalG",
      label: "חלבון",
      recommendation: basis
        ? `${fmt(basis.recommendedG)} גרם ליום: ${basis.gPerKg} גרם לכל ק"ג ` +
          (basis.fromTargetWeight ? `ממשקל היעד (${fmt(basis.referenceWeightKg)} ק"ג)` : `מהמשקל (${fmt(basis.referenceWeightKg)} ק"ג)`) +
          (basis.cappedByCalories ? ", מוגבל ל-35% מהקלוריות" : "")
        : null,
      suggested: basis ? basis.recommendedG : null,
    },
    {
      key: "fatGoalG",
      label: "שומן",
      recommendation: rec ? `${fmt(rec.fat.min)}–${fmt(rec.fat.max)} גרם ליום: 20%–35% מהקלוריות` : null,
      suggested: rec ? Math.round((rec.fat.min + rec.fat.max) / 2) : null,
    },
    {
      key: "carbsGoalG",
      label: "פחמימות",
      recommendation: rec ? `${fmt(rec.carbs.min)}–${fmt(rec.carbs.max)} גרם ליום: מה שנשאר מהיעד אחרי חלבון ושומן` : null,
      suggested: rec ? Math.round((rec.carbs.min + rec.carbs.max) / 2) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">חלבון, פחמימות ושומן</h3>
        <p className="text-xs text-slate-500">ההמלצה מתעדכנת לבד לפי המשקל והיעד הקלורי. אפשר לקבוע ערך משלך לכל אחד.</p>
      </div>
      {rows.map((row) => (
        <MacroRow
          key={row.key}
          id={row.key}
          label={row.label}
          value={form[row.key]}
          error={errors[row.key]}
          recommendation={row.recommendation}
          suggested={row.suggested}
          onChange={(value) => onChange(row.key, value)}
        />
      ))}
      {macros?.carbsBelowUsualRange ? (
        <p className="text-xs text-slate-600">
          ביעד הקלורי הנוכחי הפחמימות יוצאות מעט מתחת ל-45% המקובלים. בירידה במשקל זה בסדר: במחקרים, חלוקה שונה בין פחמימות לשומן הביאה לירידה דומה.
        </p>
      ) : null}
      <details className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">על מה זה מבוסס</summary>
        <ul className="mt-2 list-disc space-y-1 ps-4">
          <li>
            חלבון: בגירעון קלורי, צריכה מעל ההמלצה הכללית (0.8 גרם לק"ג) עוזרת לשמור על מסת השריר. לאנשים פעילים ההמלצה היא
            1.2–1.7 גרם לק"ג, ולבניית שריר כ-1.6–2.2. כאן: 1.6 בירידה, בעלייה או בפעילות בינונית, 1.2 בשמירה. עם יעד משקל נמוך
            יותר החישוב לפי משקל היעד.
          </li>
          <li>שומן 20%–35% מהקלוריות ופחמימות 45%–65%: הטווחים המקובלים למבוגרים (האקדמיה הלאומית למדעים בארה&quot;ב).</li>
          <li>בירידה במשקל, דיאטה דלת שומן ודיאטה דלת פחמימות הביאו לתוצאה דומה (ניסוי DIETFITS). לכן החלוקה ביניהן לפי העדפה.</li>
          <li>ההמלצה היא הערכה כללית ולא ייעוץ אישי.</li>
        </ul>
      </details>
      <p className="text-xs text-slate-500">בעיות כליה או מצב רפואי אחר: כדאי להתייעץ עם רופא לפני הגדלת החלבון.</p>
    </div>
  );
}

function MacroRow({
  id,
  label,
  value,
  error,
  recommendation,
  suggested,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  recommendation: string | null;
  suggested: number | null;
  onChange: (value: string) => void;
}) {
  const [own, setOwn] = useState(value.trim() !== "");
  const option = (active: boolean) =>
    "rounded-lg px-2.5 py-1 text-xs font-medium " +
    (active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900");

  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label={`יעד ${label}`}>
          <button
            type="button"
            aria-pressed={!own}
            className={option(!own)}
            onClick={() => {
              setOwn(false);
              onChange("");
            }}
          >
            לפי ההמלצה
          </button>
          <button
            type="button"
            aria-pressed={own}
            className={option(own)}
            onClick={() => {
              setOwn(true);
              if (value.trim() === "" && suggested !== null) onChange(String(suggested));
            }}
          >
            ערך שלי
          </button>
        </div>
      </div>
      {own ? (
        <div className="flex items-center gap-2">
          <TextInput
            id={id}
            inputMode="numeric"
            className="w-24"
            value={value}
            aria-label={`${label} בגרם ליום`}
            aria-invalid={Boolean(error)}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-sm text-slate-600">גרם ליום</span>
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
      <p className="text-xs text-slate-500">
        {recommendation ? `המלצה: ${recommendation}` : "ההמלצה תופיע אחרי מילוי מין, גיל, גובה ומשקל."}
      </p>
    </div>
  );
}
