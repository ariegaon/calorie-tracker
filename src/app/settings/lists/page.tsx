"use client";

import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/SettingsShell";
import { Button, Card, Field, Notice, TextInput } from "@/components/ui";
import { conditionNameError, MAX_CONDITIONS, moveCondition, type ConditionRow } from "@/lib/conditions/conditions";
import {
  addCondition,
  loadConditions,
  renameCondition,
  saveConditionOrder,
  setConditionHidden,
} from "@/lib/conditions/data";

export default function ListsPage() {
  return <SettingsShell title="רשימות שלי">{(userId) => <WeighInConditions userId={userId} />}</SettingsShell>;
}

function WeighInConditions({ userId }: { userId: string }) {
  const [rows, setRows] = useState<ConditionRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadConditions(userId)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setError("לא הצלחנו לטעון את הרשימה. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

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
    const problem = conditionNameError(editName, list, row.id);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      const name = await renameCondition(userId, row, editName);
      setRows((current) => (current ?? []).map((item) => (item.id === row.id ? { ...item, name } : item)));
      setEditingId(null);
    }, "השם עודכן, גם בשקילות הקודמות.");
  }

  function add() {
    const problem = conditionNameError(newName, list);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      const position = list.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      const row = await addCondition(userId, newName, position);
      setRows((current) => [...(current ?? []), row]);
      setNewName("");
    });
  }

  function move(row: ConditionRow, direction: -1 | 1) {
    const updates = moveCondition(list, row.id, direction);
    if (updates.length === 0) return;
    void run(async () => {
      await saveConditionOrder(userId, updates);
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
      await setConditionHidden(userId, row.id, !row.hidden);
      setRows((current) => (current ?? []).map((item) => (item.id === row.id ? { ...item, hidden: !row.hidden } : item)));
    });
  }

  const iconButton =
    "flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40";

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">תנאי שקילה</h2>
      <p className="text-sm text-slate-600">
        האפשרויות שמופיעות בטופס השקילה. שינוי שם חל גם על השקילות הקודמות, כדי שהמגמה לפי תנאי שקילה תישאר רציפה. תנאי
        מוסתר לא מופיע בטופס, והשקילות הקודמות שומרות אותו.
      </p>
      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      <ul className="divide-y divide-slate-100">
        {list.map((row, index) => (
          <li key={row.id} className="space-y-2 py-2">
            {editingId === row.id ? (
              <div className="space-y-2">
                <TextInput
                  aria-label="שם התנאי"
                  maxLength={40}
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
              <div className="flex items-center gap-2">
                <span className={"flex-1 " + (row.hidden ? "text-slate-400 line-through" : "text-slate-800")}>
                  {row.name}
                </span>
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
                  className="min-h-10 rounded-lg px-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(row.id);
                    setEditName(row.name);
                    setError(null);
                  }}
                >
                  עריכה
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => toggleHidden(row)}
                >
                  {row.hidden ? "הצגה" : "הסתרה"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {list.length < MAX_CONDITIONS ? (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <Field label="תנאי חדש" htmlFor="add-condition">
            <TextInput
              id="add-condition"
              maxLength={40}
              placeholder="למשל: בוקר, אחרי שחייה"
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
        <p className="text-sm text-slate-600">הגעת ל-{MAX_CONDITIONS} תנאים. אפשר להסתיר תנאי שלא בשימוש.</p>
      )}
    </Card>
  );
}
