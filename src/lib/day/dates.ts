// Date helpers for the daily view. All "days" are in the device's local time zone.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The [from, to) instants of a local day, as ISO strings for database queries. */
export function dayRangeIso(day: Date): { from: string; to: string } {
  return { from: startOfDay(day).toISOString(), to: addDays(day, 1).toISOString() };
}

/** Value for <input type="datetime-local">: local time, minute precision. */
export function toLocalInputValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Parses a datetime-local value as local time. Null if it is not a real date and time. */
export function parseLocalInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;
  return valid ? date : null;
}

/** Default time for a new entry: now when adding to today, otherwise noon of the chosen day. */
export function defaultEntryTime(selectedDay: Date, now: Date): Date {
  if (isSameDay(selectedDay, now)) return now;
  return new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), 12, 0);
}

export function relativeDayName(day: Date, today: Date): "today" | "yesterday" | "tomorrow" | null {
  if (isSameDay(day, today)) return "today";
  if (isSameDay(day, addDays(today, -1))) return "yesterday";
  if (isSameDay(day, addDays(today, 1))) return "tomorrow";
  return null;
}

export function formatDayLabel(day: Date, today: Date): string {
  const full = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(day);
  const relative = relativeDayName(day, today);
  if (relative === "today") return `היום, ${full}`;
  if (relative === "yesterday") return `אתמול, ${full}`;
  if (relative === "tomorrow") return `מחר, ${full}`;
  return full;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
