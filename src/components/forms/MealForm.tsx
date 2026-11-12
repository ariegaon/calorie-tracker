"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Notice, Select, TextInput } from "@/components/ui";
import { FavoriteOption, FormFooter } from "@/components/Sheet";
import { defaultEntryTime, toLocalInputValue } from "@/lib/day/dates";
import {
  MAX_MEAL_ITEMS,
  MEAL_TYPE_LABELS,
  validateMeal,
  type FoodRow,
  type MealErrors,
  type MealItemForm,
} from "@/lib/day/entries";
import { deleteFood, saveMeal } from "@/lib/day/data";
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_SCORE,
  scaleNutrition,
  type Confidence,
  type MealAnalysis,
  type NutritionBasis,
} from "@/lib/ai/meal";
import { parseNumber } from "@/lib/validation/profile";
import { mealFavoritePayload } from "@/lib/favorites";
import { addFavorite } from "@/lib/favorites-data";

export type AiMealDraft = { analysis: MealAnalysis; source: "ai_photo" | "ai_text" };

type ItemState = MealItemForm & {
  key: string;
  /** Known values for a known quantity: lets a corrected quantity rescale the rest. */
  basis: NutritionBasis | null;
  fromAi: boolean;
  confidence: Confidence | null;
  confidenceScore: number | null;
  note: string | null;
  /** Values as first shown, to tell whether the user corrected them. */
  original: MealItemForm | null;
  alreadyCorrected: boolean;
};

type FormState = { name: string; mealType: string; dateTime: string; notes: string; items: ItemState[] };

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `item-${keyCounter}`;
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(Number(value));
}

function fields(item: MealItemForm): MealItemForm {
  return {
    name: item.name,
    quantityG: item.quantityG,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  };
}

function basisOf(item: MealItemForm): NutritionBasis | null {
  const quantity = parseNumber(item.quantityG);
  const calories = parseNumber(item.calories);
  if (quantity === null || quantity <= 0 || calories === null) return null;
  return {
    quantityG: quantity,
    caloriesKcal: calories,
    proteinG: parseNumber(item.protein) ?? 0,
    carbsG: parseNumber(item.carbs) ?? 0,
    fatG: parseNumber(item.fat) ?? 0,
  };
}

function emptyItem(): ItemState {
  return {
    key: nextKey(),
    name: "",
    quantityG: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    basis: null,
    fromAi: false,
    confidence: null,
    confidenceScore: null,
    note: null,
    original: null,
    alreadyCorrected: false,
  };
}

function initialState(existing: FoodRow | null, draft: AiMealDraft | null, day: Date): FormState {
  if (existing) {
    return {
      name: existing.name ?? "",
      mealType: existing.meal_type ?? "",
      dateTime: toLocalInputValue(new Date(existing.consumed_at)),
      notes: existing.notes ?? "",
      items: existing.items.map((row) => {
        const values: MealItemForm = {
          name: row.food_name,
          quantityG: numberText(row.quantity),
          calories: numberText(row.calories_kcal),
          protein: numberText(row.protein_g),
          carbs: numberText(row.carbs_g),
          fat: numberText(row.fat_g),
        };
        return {
          ...values,
          key: nextKey(),
          basis: basisOf(values),
          fromAi: row.source === "ai_estimate",
          confidence: null,
          confidenceScore: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
          note: null,
          original: values,
          alreadyCorrected: row.user_corrected === true,
        };
      }),
    };
  }

  const dateTime = toLocalInputValue(defaultEntryTime(day, new Date()));
  if (!draft) return { name: "", mealType: "", dateTime, notes: "", items: [emptyItem()] };

  return {
    name: draft.analysis.mealName,
    mealType: "",
    dateTime,
    notes: "",
    items: draft.analysis.items.map((item) => {
      const values: MealItemForm = {
        name: item.preparation ? `${item.name} (${item.preparation})` : item.name,
        quantityG: numberText(item.quantityG),
        calories: numberText(item.caloriesKcal),
        protein: numberText(item.proteinG),
        carbs: numberText(item.carbsG),
        fat: numberText(item.fatG),
      };
      return {
        ...values,
        key: nextKey(),
        basis: basisOf(values),
        fromAi: true,
        confidence: item.confidence,
        confidenceScore: CONFIDENCE_SCORE[item.confidence],
        note: item.note,
        original: values,
        alreadyCorrected: false,
      };
    }),
  };
}

function wasCorrected(item: ItemState): boolean {
  if (item.alreadyCorrected) return true;
  if (!item.original) return false;
  const now = fields(item);
  return (Object.keys(now) as (keyof MealItemForm)[]).some((key) => now[key].trim() !== item.original?.[key].trim());
}

function total(items: ItemState[], key: "calories" | "protein" | "carbs" | "fat"): number {
  return items.reduce((sum, item) => sum + (parseNumber(item[key]) ?? 0), 0);
}

export function MealForm({
  userId,
  day,
  existing,
  draft,
  onDone,
}: {
  userId: string;
  day: Date;
  existing: FoodRow | null;
  draft: AiMealDraft | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(existing, draft, day));
  const [errors, setErrors] = useState<MealErrors>({ itemErrors: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asFavorite, setAsFavorite] = useState(false);
  const [favoriteSaved, setFavoriteSaved] = useState(false);

  const hasAiItems = form.items.some((item) => item.fromAi);

  function setField(key: "name" | "mealType" | "dateTime" | "notes", value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function setItemField(itemKey: string, field: keyof MealItemForm, value: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.key !== itemKey) return item;
        const next: ItemState = { ...item, [field]: value };
        if (field === "quantityG") {
          // A corrected quantity rescales calories and macros in proportion.
          const quantity = parseNumber(value);
          const scaled = item.basis && quantity !== null ? scaleNutrition(item.basis, quantity) : null;
          if (scaled) {
            next.calories = String(scaled.caloriesKcal);
            next.protein = String(scaled.proteinG);
            next.carbs = String(scaled.carbsG);
            next.fat = String(scaled.fatG);
          }
        } else if (field !== "name") {
          // A corrected value becomes the new reference for later quantity changes.
          next.basis = basisOf(next);
        }
        return next;
      }),
    }));
    setErrors((current) => ({ ...current, items: undefined, itemErrors: [] }));
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, emptyItem()] }));
    setErrors((current) => ({ ...current, items: undefined, itemErrors: [] }));
  }

  function removeItem(itemKey: string) {
    setForm((current) => ({ ...current, items: current.items.filter((item) => item.key !== itemKey) }));
    setErrors((current) => ({ ...current, itemErrors: [] }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = validateMeal({
      name: form.name,
      mealType: form.mealType,
      dateTime: form.dateTime,
      notes: form.notes,
      items: form.items.map(fields),
    });
    if (!result.ok) {
      setErrors(result.errors);
      setError("יש שדות שצריך לתקן");
      return;
    }
    setSaving(true);
    try {
      // The favorite is saved first and only once, so a retry after a failed save does not duplicate it.
      if (asFavorite && !favoriteSaved) {
        await addFavorite(userId, "meal", result.values.name, mealFavoritePayload(result.values));
        setFavoriteSaved(true);
      }
      await saveMeal(userId, result.values, existing, {
        source: draft ? draft.source : "manual",
        aiRawResult: draft ? draft.analysis : null,
        itemMeta: form.items.map((item) => ({
          confidence: item.confidenceScore,
          fromAi: item.fromAi,
          userCorrected: wasCorrected(item),
        })),
      });
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
      {hasAiItems ? (
        <Notice kind="info">
          הערכים שמסומנים "הערכת AI" הם אומדן ולא מדידה. בדוק את הכמויות ותקן לפני השמירה. שינוי הגרמים מעדכן את שאר
          הערכים בהתאם.
        </Notice>
      ) : null}

      <ul className="space-y-3">
        {form.items.map((item, index) => {
          const itemErrors = errors.itemErrors[index] ?? {};
          const id = `meal-${item.key}`;
          return (
            <li key={item.key} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={`מרכיב ${index + 1}`} htmlFor={`${id}-name`} error={itemErrors.name}>
                    <TextInput
                      id={`${id}-name`}
                      value={item.name}
                      aria-invalid={Boolean(itemErrors.name)}
                      onChange={(e) => setItemField(item.key, "name", e.target.value)}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  aria-label={`הסרת ${item.name || `מרכיב ${index + 1}`}`}
                  className="mt-7 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-red-600 hover:bg-red-50"
                >
                  ×
                </button>
              </div>

              {item.fromAi ? (
                <p className="text-xs text-slate-600">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">הערכת AI</span>
                  {item.confidence ? ` ${CONFIDENCE_LABEL[item.confidence]}` : ""}
                  {item.note ? ` · ${item.note}` : ""}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Field label="כמות (גרם)" htmlFor={`${id}-quantity`} error={itemErrors.quantityG}>
                  <TextInput
                    id={`${id}-quantity`}
                    inputMode="decimal"
                    value={item.quantityG}
                    aria-invalid={Boolean(itemErrors.quantityG)}
                    onChange={(e) => setItemField(item.key, "quantityG", e.target.value)}
                  />
                </Field>
                <Field label={'קלוריות (קק"ל)'} htmlFor={`${id}-calories`} error={itemErrors.calories}>
                  <TextInput
                    id={`${id}-calories`}
                    inputMode="decimal"
                    value={item.calories}
                    aria-invalid={Boolean(itemErrors.calories)}
                    onChange={(e) => setItemField(item.key, "calories", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="חלבון (ג')" htmlFor={`${id}-protein`} error={itemErrors.protein}>
                  <TextInput
                    id={`${id}-protein`}
                    inputMode="decimal"
                    value={item.protein}
                    aria-invalid={Boolean(itemErrors.protein)}
                    onChange={(e) => setItemField(item.key, "protein", e.target.value)}
                  />
                </Field>
                <Field label="פחמימות (ג')" htmlFor={`${id}-carbs`} error={itemErrors.carbs}>
                  <TextInput
                    id={`${id}-carbs`}
                    inputMode="decimal"
                    value={item.carbs}
                    aria-invalid={Boolean(itemErrors.carbs)}
                    onChange={(e) => setItemField(item.key, "carbs", e.target.value)}
                  />
                </Field>
                <Field label="שומן (ג')" htmlFor={`${id}-fat`} error={itemErrors.fat}>
                  <TextInput
                    id={`${id}-fat`}
                    inputMode="decimal"
                    value={item.fat}
                    aria-invalid={Boolean(itemErrors.fat)}
                    onChange={(e) => setItemField(item.key, "fat", e.target.value)}
                  />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>

      {errors.items ? <Notice kind="error">{errors.items}</Notice> : null}

      {form.items.length < MAX_MEAL_ITEMS ? (
        <Button type="button" variant="secondary" onClick={addItem}>
          + הוספת מרכיב
        </Button>
      ) : null}

      <div className="rounded-2xl bg-slate-200 px-3 py-2 text-sm">
        <span className="font-semibold">סך הכול: </span>
        <span className="tabular-nums">
          {Math.round(total(form.items, "calories"))} קק"ל · חלבון {Math.round(total(form.items, "protein"))} ג' ·
          פחמימות {Math.round(total(form.items, "carbs"))} ג' · שומן {Math.round(total(form.items, "fat"))} ג'
        </span>
      </div>

      <Field label="שם הארוחה (לא חובה)" htmlFor="meal-name" error={errors.name}>
        <TextInput id="meal-name" value={form.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="סוג ארוחה" htmlFor="meal-type" error={errors.mealType}>
          <Select id="meal-type" value={form.mealType} onChange={(e) => setField("mealType", e.target.value)}>
            <option value="">ללא</option>
            {Object.entries(MEAL_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מתי" htmlFor="meal-time" error={errors.dateTime}>
          <TextInput
            id="meal-time"
            type="datetime-local"
            value={form.dateTime}
            aria-invalid={Boolean(errors.dateTime)}
            onChange={(e) => setField("dateTime", e.target.value)}
          />
        </Field>
      </div>

      <Field label="הערות (לא חובה)" htmlFor="meal-notes">
        <TextInput id="meal-notes" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
      </Field>

      <FavoriteOption checked={asFavorite} onChange={setAsFavorite} disabled={saving || favoriteSaved} />

      <FormFooter saving={saving} error={error} isEdit={Boolean(existing)} onDelete={onDelete} />
    </form>
  );
}
