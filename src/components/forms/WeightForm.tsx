"use client";

import { useState, type FormEvent } from "react";
import { Field, Select, TextInput } from "@/components/ui";
import { FormFooter } from "@/components/Sheet";
import { defaultEntryTime, toLocalInputValue } from "@/lib/day/dates";
import { WEIGHT_CONDITIONS, validateWeight, type WeightForm as WeightFormState, type WeightRow } from "@/lib/day/entries";
import { deleteWeight, saveWeight } from "@/lib/day/data";

function initialState(existing: WeightRow | null, day: Date): WeightFormState {
  if (!existing) {
    return {
      dateTime: toLocalInputValue(defaultEntryTime(day, new Date())),
      weightKg: "",
      conditions: "",
      notes: "",
    };
  }
  return {
    dateTime: toLocalInputValue(new Date(existing.measured_at)),
    weightKg: String(Number(existing.weight_kg)),
    conditions: existing.measurement_conditions ?? "",
    notes: existing.notes ?? "",
  };
}

export function WeightForm({
  userId,
  day,
  existing,
  onDone,
}: {
  userId: string;
  day: Date;
  existing: WeightRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<WeightFormState>(() => initialState(existing, day));
  const [errors, setErrors] = useState<Partial<Record<keyof WeightFormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conditionOptions: string[] = [...WEIGHT_CONDITIONS];
  if (form.conditions !== "" && !conditionOptions.includes(form.conditions)) conditionOptions.push(form.conditions);

  function set(key: keyof WeightFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = validateWeight(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await saveWeight(userId, result.values, existing?.id ?? null);
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
      await deleteWeight(existing.id);
      onDone();
    } catch {
      setError("המחיקה נכשלה. נסה שוב.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label={'משקל (ק"ג)'} htmlFor="weight-kg" error={errors.weightKg}>
        <TextInput
          id="weight-kg"
          inputMode="decimal"
          value={form.weightKg}
          aria-invalid={Boolean(errors.weightKg)}
          onChange={(e) => set("weightKg", e.target.value)}
        />
      </Field>

      <Field
        label="תנאי השקילה (לא חובה)"
        htmlFor="weight-conditions"
        hint="שקילה באותם תנאים בכל פעם, למשל בבוקר לפני אוכל, נותנת מגמה אמינה יותר."
      >
        <Select id="weight-conditions" value={form.conditions} onChange={(e) => set("conditions", e.target.value)}>
          <option value="">לא צוין</option>
          {conditionOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="מתי" htmlFor="weight-time" error={errors.dateTime}>
        <TextInput
          id="weight-time"
          type="datetime-local"
          value={form.dateTime}
          aria-invalid={Boolean(errors.dateTime)}
          onChange={(e) => set("dateTime", e.target.value)}
        />
      </Field>

      <Field label="הערות (לא חובה)" htmlFor="weight-notes">
        <TextInput id="weight-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <FormFooter saving={saving} error={error} isEdit={Boolean(existing)} onDelete={onDelete} />
    </form>
  );
}
