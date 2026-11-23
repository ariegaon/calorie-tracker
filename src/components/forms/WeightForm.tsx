"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Select, TextInput } from "@/components/ui";
import { FormFooter } from "@/components/Sheet";
import { defaultEntryTime, toLocalInputValue } from "@/lib/day/dates";
import { validateWeight, type WeightForm as WeightFormState, type WeightRow } from "@/lib/day/entries";
import {
  DEFAULT_CONDITIONS,
  NEW_CONDITION_OPTION,
  conditionNameError,
  conditionOptions as optionsFor,
  type ConditionRow,
} from "@/lib/conditions/conditions";
import { addCondition, loadConditions } from "@/lib/conditions/data";
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

  // The user's own list; the defaults stand in until it loads (or if it cannot be loaded).
  const [conditions, setConditions] = useState<ConditionRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [addingBusy, setAddingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadConditions(userId)
      .then((rows) => {
        if (!cancelled) setConditions(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const conditionOptions =
    conditions === null
      ? optionsFor(DEFAULT_CONDITIONS.map((name, position) => ({ id: name, name, position, hidden: false })), form.conditions)
      : optionsFor(conditions, form.conditions);

  async function saveNewCondition() {
    const rows = conditions ?? [];
    const problem = conditionNameError(newName, rows);
    if (problem) {
      setNewError(problem);
      return;
    }
    setAddingBusy(true);
    setNewError(null);
    try {
      const position = rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      const row = await addCondition(userId, newName, position);
      setConditions([...rows, row]);
      set("conditions", row.name);
      setAdding(false);
      setNewName("");
    } catch {
      setNewError("השמירה נכשלה. נסה שוב.");
    } finally {
      setAddingBusy(false);
    }
  }

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
        <Select
          id="weight-conditions"
          value={adding ? NEW_CONDITION_OPTION : form.conditions}
          onChange={(e) => {
            if (e.target.value === NEW_CONDITION_OPTION) {
              setAdding(true);
              setNewError(null);
              return;
            }
            setAdding(false);
            set("conditions", e.target.value);
          }}
        >
          <option value="">לא צוין</option>
          {conditionOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          {conditions !== null ? <option value={NEW_CONDITION_OPTION}>+ תנאי חדש…</option> : null}
        </Select>
      </Field>

      {adding ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <Field label="שם התנאי החדש" htmlFor="new-condition" error={newError ?? undefined}>
            <TextInput
              id="new-condition"
              maxLength={40}
              autoFocus
              placeholder="למשל: בוקר, אחרי שחייה"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewError(null);
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={addingBusy} onClick={() => void saveNewCondition()}>
              {addingBusy ? "שומר…" : "הוספה"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={addingBusy}
              onClick={() => {
                setAdding(false);
                setNewName("");
                setNewError(null);
              }}
            >
              ביטול
            </Button>
          </div>
          <p className="text-xs text-slate-500">את הרשימה אפשר לערוך בהגדרות ← רשימות שלי.</p>
        </div>
      ) : null}

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
