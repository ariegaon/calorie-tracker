"use client";

// "איך חישבנו?": a link that opens the calculation, step by step, with the user's own numbers.

import { useState } from "react";
import { explainCalculation, type ExplainInput } from "@/lib/calculations/explain";
import { Sheet } from "@/components/Sheet";

export function CalculationExplainer({ input, className = "" }: { input: ExplainInput | null; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!input) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={"text-sm font-medium text-emerald-700 underline " + className}
      >
        איך חישבנו?
      </button>
      {open ? (
        <Sheet title="איך חישבנו" onClose={() => setOpen(false)}>
          <CalculationSteps input={input} />
        </Sheet>
      ) : null}
    </>
  );
}

function CalculationSteps({ input }: { input: ExplainInput }) {
  const steps = explainCalculation(input);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">כל המספרים הם הערכה, מחושבים מהנתונים שלך.</p>
      {steps.map((step) => (
        <section key={step.title} className="space-y-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm">
          <h3 className="font-semibold">{step.title}</h3>
          {step.lines.map((line) =>
            // Arithmetic lines (no Hebrew) read left to right, like on a calculator.
            !/[א-ת]/.test(line) ? (
              <p key={line} dir="ltr" className="text-end font-mono text-sm tabular-nums text-slate-700">
                {line}
              </p>
            ) : (
              <p key={line} className="text-sm text-slate-700">
                {line}
              </p>
            ),
          )}
          {step.result ? <p className="font-bold text-emerald-700">= {step.result}</p> : null}
        </section>
      ))}
      <details className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">על מה זה מבוסס</summary>
        <ul className="mt-2 list-disc space-y-1 ps-4">
          <li>Mifflin-St Jeor: הנוסחה שנמצאה המדויקת ביותר להערכת הוצאה במנוחה אצל מבוגרים, בטעות של כ-10% לרוב האנשים.</li>
          <li>7,700 קק"ל לק"ג: הערכה מקובלת. בפועל הגוף מסתגל, ולכן הירידה בדרך כלל מאטה עם הזמן.</li>
          <li>רצפה של 1,200 לנשים ו-1,500 לגברים: מתחת לזה קשה לקבל את כל הרכיבים התזונתיים בלי ליווי מקצועי.</li>
          <li>חלבון, שומן ופחמימות: ההמלצות המקובלות (ACSM והאקדמיה הלאומית למדעים בארה&quot;ב). הפירוט בפרופיל ויעדים.</li>
        </ul>
      </details>
    </div>
  );
}
