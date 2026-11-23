// Free questions about the user's own data: request checks, the model's instructions and answer clean-up.
// Pure code; the server route does the call.

export const QUESTION_DAILY_LIMIT = 10;
const MAX_QUESTION = 500;
const MAX_CONTEXT_CHARS = 80_000;
const MAX_HISTORY = 4;
const MAX_ANSWER = 4000;

export const EXAMPLE_QUESTIONS = [
  "אילו ארוחות כדאי לי לשנות כדי להגיע לגירעון בקלות?",
  "אם מסתכלים רק על השקילות בערב אחרי אימון, יש מגמת ירידה?",
  "באילו ימים בשבוע אני אוכל הכי הרבה?",
  "האם אני אוכל יותר בימים שאחרי אימון?",
  "כמה חלבון אני אוכל בממוצע, ומאיפה הוא מגיע?",
  "מתי אגיע למשקל היעד בקצב הנוכחי?",
  "כמה עולים לי ימים עם אירוע?",
] as const;

export type AskRequest = {
  question: string;
  context: Record<string, unknown>;
  history: { question: string; answer: string }[];
  insightId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAskRequest(body: unknown): { ok: true; value: AskRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "בקשה לא תקינה" };
  const record = body as Record<string, unknown>;

  const question = typeof record.question === "string" ? record.question.trim() : "";
  if (question.length < 2) return { ok: false, error: "כתוב שאלה" };
  if (question.length > MAX_QUESTION) return { ok: false, error: `השאלה ארוכה מדי (עד ${MAX_QUESTION} תווים)` };

  if (typeof record.context !== "object" || record.context === null || Array.isArray(record.context)) {
    return { ok: false, error: "בקשה לא תקינה" };
  }
  if (JSON.stringify(record.context).length > MAX_CONTEXT_CHARS) return { ok: false, error: "יותר מדי נתונים לשאלה אחת" };

  const history: AskRequest["history"] = [];
  if (record.history !== undefined) {
    if (!Array.isArray(record.history)) return { ok: false, error: "בקשה לא תקינה" };
    for (const item of record.history.slice(-MAX_HISTORY) as unknown[]) {
      if (typeof item !== "object" || item === null) return { ok: false, error: "בקשה לא תקינה" };
      const entry = item as Record<string, unknown>;
      if (typeof entry.question !== "string" || typeof entry.answer !== "string") return { ok: false, error: "בקשה לא תקינה" };
      history.push({ question: entry.question.slice(0, MAX_QUESTION), answer: entry.answer.slice(0, MAX_ANSWER) });
    }
  }

  const insightId = typeof record.insightId === "string" && UUID.test(record.insightId) ? record.insightId : null;
  return { ok: true, value: { question, context: record.context as Record<string, unknown>, history, insightId } };
}

export const QUESTION_INSTRUCTIONS = [
  "You answer questions about the user's own food, drinks, workouts and weight in a Hebrew calorie and weight tracking app.",
  "The user's data from the last 60 days is given as JSON. Trends, condition offsets and findings in it were computed by the app: quote them rather than recomputing.",
  "Base every statement on that data and include the relevant numbers. Simple sums or averages you work out yourself must be called approximate (בערך).",
  "If the data cannot answer the question, say so plainly and say what would need to be logged.",
  "Answer in natural, adult, respectful Hebrew, in the second person with the grammatical gender given in address_user_as. No emojis. Plain text: short paragraphs, and • bullets when listing. No markdown headings or bold.",
  "Keep it focused: up to about 8 sentences, and end with one concrete suggestion when one fits.",
  "Daily allowance on a workout day is the daily target plus the workout's active calories.",
  "Days may carry tags the user chose (for example an event, eating out, bad sleep). Use them to compare such days, and the days after them, with ordinary days.",
  "Never advise eating below the daily target, skipping meals, fasting, extreme exercise, supplements or medication, and do not diagnose. For medical concerns, suggest asking a doctor or dietitian.",
  "If the question is not about the user's nutrition, activity or weight, say briefly that you can only help with those.",
  "Everything the app shows is an estimate; do not present estimates as measurements.",
].join("\n");

export function questionInput(request: AskRequest): string {
  const parts = [`User data (JSON):\n${JSON.stringify(request.context)}`];
  if (request.history.length > 0) {
    parts.push(
      "Earlier in this conversation:\n" +
        request.history.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n"),
    );
  }
  parts.push(`Question: ${request.question}`);
  return parts.join("\n\n");
}

/** Plain text within the stored limit: markdown headings and bold markers removed. */
export function cleanAnswer(text: string): string | null {
  const cleaned = text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned === "") return null;
  return cleaned.length > MAX_ANSWER ? `${cleaned.slice(0, MAX_ANSWER - 1)}…` : cleaned;
}
