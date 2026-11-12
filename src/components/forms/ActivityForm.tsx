"use client";

import { useState, type FormEvent } from "react";
import { Field, Notice, Select, TextInput } from "@/components/ui";
import { FormFooter } from "@/components/Sheet";
import { defaultEntryTime, toLocalInputValue } from "@/lib/day/dates";
import {
  ACTIVITY_TYPES,
  validateActivity,
  type ActivityForm as ActivityFormState,
  type ActivityRow,
} from "@/lib/day/entries";
import { deleteActivity, saveActivity } from "@/lib/day/data";

function initialState(existing: ActivityRow | null, day: Date): ActivityFormState {
  if (!existing) {
    return {
      activityType: ACTIVITY_TYPES[0],
      dateTime: toLocalInputValue(defaultEntryTime(day, new Date())),
      durationMin: "",
      distanceKm: "",
      activeKcal: "",
      notes: "",
    };
  }
  return {
    activityType: existing.activity_type,
    dateTime: toLocalInputValue(new Date(existing.started_at)),
    durationMin: existing.duration_seconds === null ? "" : String(Math.round(Number(existing.duration_seconds) / 60)),
    distanceKm: existing.distance_m === null ? "" : String(Number(existing.distance_m) / 1000),
    activeKcal: existing.calories_active_kcal === null ? "" : String(Number(existing.calories_active_kcal)),
    notes: existing.notes ?? "",
  };
}

export function ActivityForm({
  userId,
  day,
  existing,
  onDone,
}: {
  userId: string;
  day: Date;
  existing: ActivityRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ActivityFormState>(() => initialState(existing, day));
  const [errors, setErrors] = useState<Partial<Record<keyof ActivityFormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeOptions: string[] = [...ACTIVITY_TYPES];
  if (!typeOptions.includes(form.activityType)) typeOptions.push(form.activityType);

  function set(key: keyof ActivityFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = validateActivity(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await saveActivity(userId, result.values, existing?.id ?? null);
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
      await deleteActivity(existing.id);
      onDone();
    } catch {
      setError("המחיקה נכשלה. נסה שוב.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {existing?.external_provider ? (
        <Notice kind="info">הפעילות הזאת הגיעה מסנכרון. שינוי כאן לא ישנה אותה במקור.</Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="סוג פעילות" htmlFor="activity-type" error={errors.activityType}>
          <Select id="activity-type" value={form.activityType} onChange={(e) => set("activityType", e.target.value)}>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="משך (דקות)" htmlFor="activity-duration" error={errors.durationMin}>
          <TextInput
            id="activity-duration"
            inputMode="numeric"
            value={form.durationMin}
            aria-invalid={Boolean(errors.durationMin)}
            onChange={(e) => set("durationMin", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={'מרחק (ק"מ, לא חובה)'} htmlFor="activity-distance" error={errors.distanceKm}>
          <TextInput
            id="activity-distance"
            inputMode="decimal"
            value={form.distanceKm}
            aria-invalid={Boolean(errors.distanceKm)}
            onChange={(e) => set("distanceKm", e.target.value)}
          />
        </Field>
        <Field label={'קלוריות פעילות (קק"ל)'} htmlFor="activity-kcal" error={errors.activeKcal}>
          <TextInput
            id="activity-kcal"
            inputMode="numeric"
            value={form.activeKcal}
            aria-invalid={Boolean(errors.activeKcal)}
            onChange={(e) => set("activeKcal", e.target.value)}
          />
        </Field>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        יש להזין קלוריות פעילות (Active) ולא קלוריות כוללות (Total). ההוצאה במנוחה כבר נספרת בהוצאה היומית, ולכן
        קלוריות כוללות היו נספרות פעמיים. בלי קלוריות, הפעילות תירשם אבל לא תשפיע על המאזן.
      </p>

      <Field label="מתי התחלת" htmlFor="activity-time" error={errors.dateTime}>
        <TextInput
          id="activity-time"
          type="datetime-local"
          value={form.dateTime}
          aria-invalid={Boolean(errors.dateTime)}
          onChange={(e) => set("dateTime", e.target.value)}
        />
      </Field>

      <Field label="הערות (לא חובה)" htmlFor="activity-notes">
        <TextInput id="activity-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <FormFooter saving={saving} error={error} isEdit={Boolean(existing)} onDelete={onDelete} />
    </form>
  );
}
