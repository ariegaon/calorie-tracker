"use client";

import { useState, type FormEvent } from "react";
import { Field, Select, TextInput } from "@/components/ui";
import { FormFooter } from "@/components/Sheet";
import { defaultEntryTime, toLocalInputValue } from "@/lib/day/dates";
import { MEAL_TYPE_LABELS, validateFood, type FoodForm as FoodFormState, type FoodRow } from "@/lib/day/entries";
import { deleteFood, saveFood } from "@/lib/day/data";

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(Number(value));
}

function initialState(existing: FoodRow | null, day: Date): FoodFormState {
  if (!existing) {
    return {
      name: "",
      mealType: "",
      dateTime: toLocalInputValue(defaultEntryTime(day, new Date())),
      quantityG: "",
      calories: "",
      protein: "",
      carbs: "",
      fat: "",
      notes: "",
    };
  }
  const items = existing.items;
  const sum = (pick: (item: FoodRow["items"][number]) => number) =>
    items.reduce((total, item) => total + Number(pick(item)), 0);
  return {
    name: existing.name ?? items[0]?.food_name ?? "",
    mealType: existing.meal_type ?? "",
    dateTime: toLocalInputValue(new Date(existing.consumed_at)),
    quantityG: items.length === 1 ? numberText(items[0].quantity) : "",
    calories: numberText(sum((item) => item.calories_kcal)),
    protein: numberText(sum((item) => item.protein_g)),
    carbs: numberText(sum((item) => item.carbs_g)),
    fat: numberText(sum((item) => item.fat_g)),
    notes: existing.notes ?? "",
  };
}

export function FoodForm({
  userId,
  day,
  existing,
  onDone,
}: {
  userId: string;
  day: Date;
  existing: FoodRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FoodFormState>(() => initialState(existing, day));
  const [errors, setErrors] = useState<Partial<Record<keyof FoodFormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof FoodFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = validateFood(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await saveFood(userId, result.values, existing);
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
      await deleteFood(existing.id);
      onDone();
    } catch {
      setError("המחיקה נכשלה. נסה שוב.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label="מה אכלת?" htmlFor="food-name" error={errors.name}>
        <TextInput
          id="food-name"
          value={form.name}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={'קלוריות (קק"ל)'} htmlFor="food-calories" error={errors.calories}>
          <TextInput
            id="food-calories"
            inputMode="decimal"
            value={form.calories}
            aria-invalid={Boolean(errors.calories)}
            onChange={(e) => set("calories", e.target.value)}
          />
        </Field>
        <Field label="כמות (גרם, לא חובה)" htmlFor="food-quantity" error={errors.quantityG}>
          <TextInput
            id="food-quantity"
            inputMode="decimal"
            value={form.quantityG}
            aria-invalid={Boolean(errors.quantityG)}
            onChange={(e) => set("quantityG", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="חלבון (ג')" htmlFor="food-protein" error={errors.protein}>
          <TextInput
            id="food-protein"
            inputMode="decimal"
            value={form.protein}
            aria-invalid={Boolean(errors.protein)}
            onChange={(e) => set("protein", e.target.value)}
          />
        </Field>
        <Field label="פחמימות (ג')" htmlFor="food-carbs" error={errors.carbs}>
          <TextInput
            id="food-carbs"
            inputMode="decimal"
            value={form.carbs}
            aria-invalid={Boolean(errors.carbs)}
            onChange={(e) => set("carbs", e.target.value)}
          />
        </Field>
        <Field label="שומן (ג')" htmlFor="food-fat" error={errors.fat}>
          <TextInput
            id="food-fat"
            inputMode="decimal"
            value={form.fat}
            aria-invalid={Boolean(errors.fat)}
            onChange={(e) => set("fat", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="סוג ארוחה" htmlFor="food-meal" error={errors.mealType}>
          <Select id="food-meal" value={form.mealType} onChange={(e) => set("mealType", e.target.value)}>
            <option value="">ללא</option>
            {Object.entries(MEAL_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מתי" htmlFor="food-time" error={errors.dateTime}>
          <TextInput
            id="food-time"
            type="datetime-local"
            value={form.dateTime}
            aria-invalid={Boolean(errors.dateTime)}
            onChange={(e) => set("dateTime", e.target.value)}
          />
        </Field>
      </div>

      <Field label="הערות (לא חובה)" htmlFor="food-notes">
        <TextInput id="food-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <FormFooter saving={saving} error={error} isEdit={Boolean(existing)} onDelete={onDelete} />
    </form>
  );
}
