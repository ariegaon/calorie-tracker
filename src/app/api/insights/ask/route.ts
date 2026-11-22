import { authenticate, insertRows, json, selectRows, type Access } from "@/lib/server/supabase";
import { extractOutputText } from "@/lib/ai/meal";
import {
  QUESTION_DAILY_LIMIT,
  QUESTION_INSTRUCTIONS,
  cleanAnswer,
  questionInput,
  validateAskRequest,
} from "@/lib/insights/questions";

// Server-only: the OpenAI key never reaches the browser. The data summary was built by the app from the
// user's own rows (read under row level security) and holds no name, email or account id.
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "gpt-6.1-terra";

async function hasConsent(access: Access): Promise<boolean> {
  const rows = await selectRows<{ ai_insights_consent_at: string | null }>(
    access,
    "profiles",
    `select=ai_insights_consent_at&user_id=eq.${access.userId}`,
  );
  return Boolean(rows[0]?.ai_insights_consent_at);
}

async function questionsToday(access: Access): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const rows = await selectRows<{ id: string }>(
    access,
    "ai_usage",
    `select=id&kind=eq.question&created_at=gte.${encodeURIComponent(since)}`,
  );
  return rows.length;
}

export async function POST(request: Request): Promise<Response> {
  const access = await authenticate(request);
  if (access instanceof Response) return access;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, { error: "השאלות לא הוגדרו בשרת" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "בקשה לא תקינה" });
  }
  const validated = validateAskRequest(body);
  if (!validated.ok) return json(400, { error: validated.error });

  // Consent and the daily cap are checked, and the use recorded, before the paid call.
  try {
    if (!(await hasConsent(access))) return json(403, { error: "צריך קודם לאשר את השימוש ב-AI" });
    if ((await questionsToday(access)) >= QUESTION_DAILY_LIMIT) {
      return json(429, { error: `הגעת ל-${QUESTION_DAILY_LIMIT} שאלות ב-24 שעות. אפשר לשאול שוב מחר` });
    }
    await insertRows(access, "ai_usage", [{ user_id: access.userId, kind: "question" }]);
  } catch {
    return json(502, { error: "לא הצלחנו לבדוק את המכסה. נסה שוב" });
  }

  let answer: string | null = null;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: QUESTION_INSTRUCTIONS,
        input: [{ role: "user", content: [{ type: "input_text", text: questionInput(validated.value) }] }],
        max_output_tokens: 4000,
        store: false,
      }),
      signal: AbortSignal.timeout(50_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("ask: model returned an error", response.status);
      return json(502, { error: response.status === 429 ? "השירות עמוס כרגע. נסה שוב עוד מעט" : "לא התקבלה תשובה. נסה שוב" });
    }
    const output = extractOutputText(await response.json());
    if (output.kind === "refusal") answer = "אני יכול לעזור רק בשאלות על התזונה, הפעילות והמשקל שלך.";
    else if (output.kind === "text") answer = cleanAnswer(output.text);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("ask: request to the model failed", timedOut ? "timeout" : "network");
    return json(504, { error: timedOut ? "התשובה לקחה יותר מדי זמן. נסה שוב" : "אין תשובה מהשירות. נסה שוב" });
  }
  if (!answer) return json(502, { error: "לא התקבלה תשובה. נסה שוב" });

  try {
    await insertRows(access, "insight_questions", [
      { user_id: access.userId, question: validated.value.question, answer, insight_id: validated.value.insightId },
    ]);
  } catch {
    // The answer is still returned; only the history entry is missing.
    console.error("ask: saving the answer failed");
  }
  return json(200, { answer });
}
