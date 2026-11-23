"use client";

import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/SettingsShell";
import { Button, Card, Field, Notice, TextInput } from "@/components/ui";
import {
  conditionNameError,
  MAX_CONDITION_LENGTH,
  MAX_CONDITIONS,
  moveCondition,
  type ConditionRow,
} from "@/lib/conditions/conditions";
import {
  addCondition,
  loadConditions,
  renameCondition,
  saveConditionOrder,
  setConditionHidden,
} from "@/lib/conditions/data";
import { MAX_TAG_LENGTH, MAX_TAGS, tagNameError } from "@/lib/tags/tags";
import { addTag, loadTags, renameTag, saveTagOrder, setTagHidden } from "@/lib/tags/data";

type Row = ConditionRow;

type ListApi = {
  id: string;
  title: string;
  description: string;
  renamedNotice: string;
  placeholder: string;
  max: number;
  maxLength: number;
  load: (userId: string) => Promise<Row[]>;
  add: (userId: string, name: string, position: number) => Promise<Row>;
  rename: (userId: string, row: Row, name: string) => Promise<string>;
  setHidden: (userId: string, id: string, hidden: boolean) => Promise<void>;
  saveOrder: (userId: string, updates: { id: string; position: number }[]) => Promise<void>;
  nameError: (raw: string, rows: Row[], renamingId?: string | null) => string | null;
};

const TAGS: ListApi = {
  id: "tags",
  title: "תגיות יום",
  description: "סימונים ליום בלי קלוריות, לתובנות. שינוי שם חל גם על ימים שכבר סומנו.",
  renamedNotice: "השם עודכן.",
  placeholder: "למשל: טיול, יום הולדת",
  max: MAX_TAGS,
  maxLength: MAX_TAG_LENGTH,
  load: loadTags,
  add: addTag,
  rename: renameTag,
  setHidden: setTagHidden,
  saveOrder: saveTagOrder,
  nameError: tagNameError,
};

const CONDITIONS: ListApi = {
  id: "conditions",
  title: "תנאי שקילה",
  description: "האפשרויות בטופס השקילה. שינוי שם חל גם על שקילות קודמות.",
  renamedNotice: "השם עודכן, גם בשקילות הקודמות.",
  placeholder: "למשל: בוקר, אחרי שחייה",
  max: MAX_CONDITIONS,
  maxLength: MAX_CONDITION_LENGTH,
  load: loadConditions,
  add: addCondition,
  rename: renameCondition,
  setHidden: setConditionHidden,
  saveOrder: saveConditionOrder,
  nameError: conditionNameError,
};

export default function ListsPage() {
  return (
    <SettingsShell title="רשימות שלי">
      {(userId) => (
        <>
          <PersonalList userId={userId} api={TAGS} />
          <PersonalList userId={userId} api={CONDITIONS} />
        </>
      )}
    </SettingsShell>
  );
}

function PersonalList({ userId, api }: { userId: string; api: ListApi }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .load(userId)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setError("לא הצלחנו לטעון את הרשימה. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, api]);

  if (!rows) return error ? <Notice kind="error">{error}</Notice> : <p className="text-slate-600">טוען…</p>;
  const list = [...rows].sort((a, b) => a.position - b.position);

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
    } catch {
      setError("השמירה נכשלה. נסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  function saveRename(row: ConditionRow) {
    const problem = api.nameError(editName, list, row.id);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      const name = await api.rename(userId, row, editName);
      setRows((current) => (current ?? []).map((item) => (item.id === row.id ? { ...item, name } : item)));
      setEditingId(null);
    }, api.renamedNotice);
  }

  function add() {
    const problem = api.nameError(newName, list);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      const position = list.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      const row = await api.add(userId, newName, position);
      setRows((current) => [...(current ?? []), row]);
      setNewName("");
    });
  }

  function move(row: ConditionRow, direction: -1 | 1) {
    const updates = moveCondition(list, row.id, direction);
    if (updates.length === 0) return;
    void run(async () => {
      await api.saveOrder(userId, updates);
      setRows((current) =>
        (current ?? []).map((item) => {
          const update = updates.find((change) => change.id === item.id);
          return update ? { ...item, position: update.position } : item;
        }),
      );
    });
  }

  function toggleHidden(row: ConditionRow) {
    void run(async () => {
      await api.setHidden(userId, row.id, !row.hidden);
      setRows((current) => (current ?? []).map((item) => (item.id === row.id ? { ...item, hidden: !row.hidden } : item)));
    });
  }

  const iconButton =
    "flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-30";

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{api.title}</h2>
      <p className="text-sm text-slate-600">{api.description}</p>
      <p className="text-xs text-slate-500">▲▼ סדר · ✎ שם · 🚫 הסתרה · 👁 החזרה</p>
      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      <ul className="divide-y divide-slate-100">
        {list.map((row, index) => (
          <li key={row.id} className="space-y-2 py-1.5">
            {editingId === row.id ? (
              <div className="space-y-2">
                <TextInput
                  aria-label="שם"
                  maxLength={api.maxLength}
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => saveRename(row)}>
                    שמירה
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>
                    ביטול
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className={
                    "min-w-0 flex-1 truncate text-[15px] " + (row.hidden ? "text-slate-400 line-through" : "font-medium text-slate-800")
                  }
                  title={row.name}
                >
                  {row.name}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className={iconButton}
                    disabled={busy || index === 0}
                    aria-label={`להזיז למעלה: ${row.name}`}
                    onClick={() => move(row, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={busy || index === list.length - 1}
                    aria-label={`להזיז למטה: ${row.name}`}
                    onClick={() => move(row, 1)}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={busy}
                    aria-label={`עריכת השם: ${row.name}`}
                    onClick={() => {
                      setEditingId(row.id);
                      setEditName(row.name);
                      setError(null);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={busy}
                    aria-label={`${row.hidden ? "הצגה" : "הסתרה"}: ${row.name}`}
                    aria-pressed={row.hidden}
                    onClick={() => toggleHidden(row)}
                  >
                    {row.hidden ? "👁" : "🚫"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {list.length < api.max ? (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <Field label="הוספה לרשימה" htmlFor={`add-${api.id}`}>
            <TextInput
              id={`add-${api.id}`}
              maxLength={api.maxLength}
              placeholder={api.placeholder}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <Button type="button" variant="secondary" disabled={busy || newName.trim() === ""} onClick={add}>
            הוספה
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">הגעת ל-{api.max} פריטים. אפשר להסתיר פריט שלא בשימוש.</p>
      )}
    </Card>
  );
}
