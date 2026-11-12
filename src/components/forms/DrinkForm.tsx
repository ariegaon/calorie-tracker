"use client";

import { useState, type FormEvent } from "react";
import { Field, TextInput } from "@/components/ui";
import { FormFooter } from "@/components/Sheet";
import { defaultEntryTime, toLocalInputValue } from "@/lib/day/dates";
import {
  DRINK_PRESETS,
  validateDrink,
  type DrinkForm as DrinkFormState,
  type DrinkPreset,
  type DrinkRow,
} from "@/lib/day/entries";
import { deleteDrink, saveDrink } from "@/lib/day/data";

function numberText(value: number | null): string {
  return value === null ? "" : String(Number(value));
}

function fromPreset(preset: DrinkPreset, dateTime: string): DrinkFormState {
  return {
    drinkType: preset.drinkType,
    dateTime,
    volumeMl: String(preset.volumeMl),
    calories: String(preset.caloriesKcal),
    caffeineMg: preset.caffeineMg > 0 ? String(preset.caffeineMg) : "",
    hydrationMl: String(preset.hydrationMl),
    notes: "",
  };
}

function initialState(existing: DrinkRow | null, day: Date): DrinkFormState {
  if (!existing) return fromPreset(DRINK_PRESETS[0], toLocalInputValue(defaultEntryTime(day, new Date())));
  return {
    drinkType: existing.drink_type,
    dateTime: toLocalInputValue(new Date(existing.consumed_at)),
    volumeMl: numberText(existing.volume_ml),
    calories: numberText(existing.calories_kcal),
    caffeineMg: numberText(existing.caffeine_mg),
    hydrationMl: numberText(existing.hydration_ml),
    notes: existing.notes ?? "",
  };
}

export function DrinkForm({
  userId,
  day,
  existing,
  onDone,
}: {
  userId: string;
  day: Date;
  existing: DrinkRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<DrinkFormState>(() => initialState(existing, day));
  const [presetKey, setPresetKey] = useState<string | null>(existing ? null : DRINK_PRESETS[0].key);
  const [errors, setErrors] = useState<Partial<Record<keyof DrinkFormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof DrinkFormState, value: string) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // Keep hydration in step with the volume until the user edits hydration itself.
      if (key === "volumeMl" && current.hydrationMl === current.volumeMl) next.hydrationMl = value;
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function choosePreset(preset: DrinkPreset) {
    setPresetKey(preset.key);
    setForm((current) => fromPreset(preset, current.dateTime));
    setErrors({});
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = validateDrink(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await saveDrink(userId, result.values, existing?.id ?? null);
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
      await deleteDrink(existing.id);
      onDone();
    } catch {
      setError("המחיקה נכשלה. נסה שוב.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {!existing ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="משקאות נפוצים">
          {DRINK_PRESETS.map((preset) => {
            const selected = preset.key === presetKey;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={selected}
                onClick={() => choosePreset(preset)}
                className={
                  "min-h-11 rounded-full border px-4 text-sm font-medium " +
                  (selected
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100")
                }
              >
                {selected ? "✓ " : ""}
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <Field label="סוג המשקה" htmlFor="drink-type" error={errors.drinkType}>
        <TextInput
          id="drink-type"
          value={form.drinkType}
          aria-invalid={Boolean(errors.drinkType)}
          onChange={(e) => {
            setPresetKey(null);
            set("drinkType", e.target.value);
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={'כמות (מ"ל)'} htmlFor="drink-volume" error={errors.volumeMl}>
          <TextInput
            id="drink-volume"
            inputMode="numeric"
            value={form.volumeMl}
            aria-invalid={Boolean(errors.volumeMl)}
            onChange={(e) => set("volumeMl", e.target.value)}
          />
        </Field>
        <Field label={'קלוריות (קק"ל)'} htmlFor="drink-calories" error={errors.calories}>
          <TextInput
            id="drink-calories"
            inputMode="decimal"
            value={form.calories}
            aria-invalid={Boolean(errors.calories)}
            onChange={(e) => set("calories", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={'קפאין (מ"ג, לא חובה)'} htmlFor="drink-caffeine" error={errors.caffeineMg}>
          <TextInput
            id="drink-caffeine"
            inputMode="numeric"
            value={form.caffeineMg}
            aria-invalid={Boolean(errors.caffeineMg)}
            onChange={(e) => set("caffeineMg", e.target.value)}
          />
        </Field>
        <Field label={'נזקף ליעד השתייה (מ"ל)'} htmlFor="drink-hydration" error={errors.hydrationMl}>
          <TextInput
            id="drink-hydration"
            inputMode="numeric"
            value={form.hydrationMl}
            aria-invalid={Boolean(errors.hydrationMl)}
            onChange={(e) => set("hydrationMl", e.target.value)}
          />
        </Field>
      </div>

      <Field label="מתי" htmlFor="drink-time" error={errors.dateTime}>
        <TextInput
          id="drink-time"
          type="datetime-local"
          value={form.dateTime}
          aria-invalid={Boolean(errors.dateTime)}
          onChange={(e) => set("dateTime", e.target.value)}
        />
      </Field>

      <p className="text-xs leading-relaxed text-slate-500">
        הקלוריות והקפאין של המשקאות המוכנים הם ערכים טיפוסיים, לא מדידה. אפשר לתקן אותם לפני השמירה.
      </p>

      <FormFooter saving={saving} error={error} isEdit={Boolean(existing)} onDelete={onDelete} />
    </form>
  );
}
