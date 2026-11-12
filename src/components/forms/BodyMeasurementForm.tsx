"use client";

import { useState, type FormEvent } from "react";
import { Field, TextInput } from "@/components/ui";
import { FormFooter } from "@/components/Sheet";
import { toLocalInputValue } from "@/lib/day/dates";
import {
  BODY_MEASURES,
  validateBodyMeasurement,
  type BodyMeasurementForm as FormState,
  type BodyMeasurementRow,
} from "@/lib/day/entries";
import { deleteBodyMeasurement, saveBodyMeasurement } from "@/lib/weight/extras-data";

function numberText(value: number | null): string {
  return value === null ? "" : String(Number(value));
}

function initialState(existing: BodyMeasurementRow | null): FormState {
  return {
    dateTime: toLocalInputValue(existing ? new Date(existing.measured_at) : new Date()),
    notes: existing?.notes ?? "",
    waist: numberText(existing?.waist_cm ?? null),
    chest: numberText(existing?.chest_cm ?? null),
    hips: numberText(existing?.hips_cm ?? null),
    thigh: numberText(existing?.thigh_cm ?? null),
    arm: numberText(existing?.arm_cm ?? null),
    bodyFat: numberText(existing?.body_fat_percent ?? null),
  };
}

export function BodyMeasurementForm({
  userId,
  existing,
  onDone,
}: {
  userId: string;
  existing: BodyMeasurementRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(existing));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = validateBodyMeasurement(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await saveBodyMeasurement(userId, result.values, existing?.id ?? null);
      onDone();
    } catch {
      setError("השמירה נכשלה. בדוק את החיבור ונסה שוב.");
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      await deleteBodyMeasurement(existing.id);
      onDone();
    } catch {
      setError("המחיקה נכשלה. נסה שוב.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">אפשר למלא רק חלק מהמדידות. מדידה באותה שעה ובאותו מקום בגוף נותנת השוואה אמינה.</p>

      <div className="grid grid-cols-2 gap-3">
        {BODY_MEASURES.map((measure) => (
          <Field
            key={measure.key}
            label={`${measure.label} (${measure.unit})`}
            htmlFor={`measure-${measure.key}`}
            error={errors[measure.key]}
          >
            <TextInput
              id={`measure-${measure.key}`}
              inputMode="decimal"
              value={form[measure.key]}
              aria-invalid={Boolean(errors[measure.key])}
              onChange={(e) => set(measure.key, e.target.value)}
            />
          </Field>
        ))}
      </div>

      <Field label="מתי" htmlFor="measure-time" error={errors.dateTime}>
        <TextInput
          id="measure-time"
          type="datetime-local"
          value={form.dateTime}
          aria-invalid={Boolean(errors.dateTime)}
          onChange={(e) => set("dateTime", e.target.value)}
        />
      </Field>

      <Field label="הערות (לא חובה)" htmlFor="measure-notes">
        <TextInput id="measure-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <FormFooter saving={saving} error={error} isEdit={Boolean(existing)} onDelete={onDelete} />
    </form>
  );
}
