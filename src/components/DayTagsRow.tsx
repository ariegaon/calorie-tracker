"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Notice, TextInput } from "@/components/ui";
import { chipsForDay, cleanNote, MAX_NOTE_LENGTH, type TagMark, type TagRow } from "@/lib/tags/tags";
import { loadDayMarks, loadTags, setDayMark, setDayMarkNote } from "@/lib/tags/data";

/**
 * Personal tags for the day shown (no calories): tap to mark or unmark, several at once.
 * Right after marking, an optional short note can be added ("Danny's wedding").
 */
export function DayTagsRow({ userId, day }: { userId: string; day: Date }) {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [marks, setMarks] = useState<TagMark[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dayKey = day.getTime();

  useEffect(() => {
    let cancelled = false;
    setNoteFor(null);
    Promise.all([loadTags(userId), loadDayMarks(userId, new Date(dayKey))])
      .then(([tagRows, markRows]) => {
        if (cancelled) return;
        setTags(tagRows);
        setMarks(markRows);
      })
      .catch(() => {
        if (!cancelled) setError("לא הצלחנו לטעון את התגיות.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, dayKey]);

  if (tags === null) return error ? <Notice kind="error">{error}</Notice> : null;
  const chips = chipsForDay(tags, marks);

  async function toggle(tag: TagRow, marked: boolean) {
    setBusyId(tag.id);
    setError(null);
    try {
      await setDayMark(userId, tag.id, new Date(dayKey), !marked);
      if (marked) {
        setMarks((current) => current.filter((mark) => mark.tagId !== tag.id));
        if (noteFor === tag.id) setNoteFor(null);
      } else {
        setMarks((current) => [...current, { tagId: tag.id, note: null }]);
        setNoteFor(tag.id);
        setNoteText("");
      }
    } catch {
      setError("השמירה נכשלה. נסה שוב.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNote(tagId: string) {
    const note = cleanNote(noteText);
    setBusyId(tagId);
    setError(null);
    try {
      await setDayMarkNote(userId, tagId, new Date(dayKey), note);
      setMarks((current) => current.map((mark) => (mark.tagId === tagId ? { ...mark, note } : mark)));
      setNoteFor(null);
    } catch {
      setError("שמירת ההערה נכשלה. נסה שוב.");
    } finally {
      setBusyId(null);
    }
  }

  const noteTag = noteFor ? tags.find((tag) => tag.id === noteFor) : undefined;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">🏷 תגיות ליום</h2>
        <Link
          href="/settings/lists"
          className="min-h-9 rounded-lg px-2 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          עריכה
        </Link>
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <ul className="flex flex-wrap gap-2">
        {chips.map(({ tag, mark }) => (
          <li key={tag.id}>
            <button
              type="button"
              disabled={busyId !== null}
              aria-pressed={mark !== null}
              onClick={() => void toggle(tag, mark !== null)}
              className={
                "min-h-10 rounded-full border px-3 text-sm font-medium disabled:opacity-60 " +
                (mark
                  ? "border-violet-500 bg-violet-50 text-violet-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
              }
            >
              {mark ? "✓ " : ""}
              {tag.name}
              {mark?.note ? <span className="text-violet-600"> · {mark.note}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      {noteTag ? (
        <div className="flex items-center gap-2">
          <TextInput
            aria-label={`הערה ל"${noteTag.name}" (לא חובה)`}
            placeholder={`הערה ל"${noteTag.name}" (לא חובה)`}
            maxLength={MAX_NOTE_LENGTH}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <button
            type="button"
            disabled={busyId !== null || noteText.trim() === ""}
            onClick={() => void saveNote(noteTag.id)}
            className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            שמירה
          </button>
          <button
            type="button"
            onClick={() => setNoteFor(null)}
            aria-label="בלי הערה"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">בלי קלוריות. משמש לתובנות: מה קורה בימים כאלה ואחריהם.</p>
      )}
    </Card>
  );
}
