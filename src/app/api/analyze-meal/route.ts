import {
  DAILY_ANALYSIS_LIMIT,
  MEAL_ANALYSIS_INSTRUCTIONS,
  MEAL_ANALYSIS_SCHEMA,
  extractOutputText,
  parseMealAnalysis,
  validateAnalyzeRequest,
} from "@/lib/ai/meal";

// Server-only route: the OpenAI key never reaches the browser.
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "gpt-6.1-terra";

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type SupabaseAccess = { url: string; key: string; token: string };

function supabaseHeaders(access: SupabaseAccess): Record<string, string> {
  return { apikey: access.key, Authorization: `Bearer ${access.token}` };
}

/** Confirms the caller's session with Supabase and returns their user id. */
async function getUserId(access: SupabaseAccess): Promise<string | null> {
  const response = await fetch(`${access.url}/auth/v1/user`, { headers: supabaseHeaders(access), cache: "no-store" });
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: unknown };
  return typeof user.id === "string" ? user.id : null;
}

/** Number of analyses the user ran in the last 24 hours. Null when it could not be read. */
async function countRecentUsage(access: SupabaseAccess): Promise<number | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(
    `${access.url}/rest/v1/ai_usage?select=id&created_at=gte.${encodeURIComponent(since)}`,
    { headers: { ...supabaseHeaders(access), Prefer: "count=exact", Range: "0-0" }, cache: "no-store" },
  );
  if (!response.ok) return null;
  const total = response.headers.get("content-range")?.split("/")[1];
  const count = Number(total);
  return Number.isInteger(count) ? count : null;
}

async function recordUsage(access: SupabaseAccess, userId: string, kind: "meal_text" | "meal_photo"): Promise<boolean> {
  const response = await fetch(`${access.url}/rest/v1/ai_usage`, {
    method: "POST",
    headers: { ...supabaseHeaders(access), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, kind }),
    cache: "no-store",
  });
  return response.ok;
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey || !openAiKey) {
    console.error("analyze-meal: missing server configuration");
    return json(500, { error: "ניתוח הארוחות לא הוגדר בשרת" });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token === "") return json(401, { error: "יש להתחבר מחדש" });
  const access: SupabaseAccess = { url: supabaseUrl, key: supabaseKey, token };

  let userId: string | null;
  try {
    userId = await getUserId(access);
  } catch {
    return json(502, { error: "לא הצלחנו לאמת את ההתחברות. נסה שוב" });
  }
  if (!userId) return json(401, { error: "יש להתחבר מחדש" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "בקשה לא תקינה" });
  }
  const validated = validateAnalyzeRequest(body);
  if (!validated.ok) return json(400, { error: validated.error });
  const { description, imageDataUrl } = validated.value;

  // Usage cap: checked and recorded before the paid call, so failures cannot be used to bypass it.
  let used: number | null;
  try {
    used = await countRecentUsage(access);
  } catch {
    used = null;
  }
  if (used === null) return json(502, { error: "לא הצלחנו לבדוק את מכסת השימוש. נסה שוב" });
  if (used >= DAILY_ANALYSIS_LIMIT) {
    return json(429, { error: `הגעת למכסה של ${DAILY_ANALYSIS_LIMIT} ניתוחים ב-24 שעות. אפשר להזין ידנית` });
  }
  const recorded = await recordUsage(access, userId, imageDataUrl ? "meal_photo" : "meal_text").catch(() => false);
  if (!recorded) return json(502, { error: "לא הצלחנו לרשום את השימוש. נסה שוב" });

  const userText =
    description !== ""
      ? `The user's description of the meal: ${description}`
      : "The user gave no description. Analyse the photo.";
  const content: Record<string, unknown>[] = [{ type: "input_text", text: userText }];
  if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl, detail: "auto" });

  let openAiResponse: Response;
  try {
    openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: MEAL_ANALYSIS_INSTRUCTIONS,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "meal_analysis", strict: true, schema: MEAL_ANALYSIS_SCHEMA } },
        max_output_tokens: 8000,
        store: false,
      }),
      signal: AbortSignal.timeout(50_000),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("analyze-meal: request to the model failed", timedOut ? "timeout" : "network");
    return json(504, { error: timedOut ? "הניתוח לקח יותר מדי זמן. נסה שוב" : "אין תשובה משירות הניתוח. נסה שוב" });
  }

  if (!openAiResponse.ok) {
    // Log the status and the provider's error code only: never the key or the user's content.
    let code = "";
    try {
      const errorBody = (await openAiResponse.json()) as { error?: { code?: unknown; type?: unknown } };
      code = String(errorBody.error?.code ?? errorBody.error?.type ?? "");
    } catch {
      // ignore: the status alone is logged
    }
    console.error("analyze-meal: model returned an error", openAiResponse.status, code);
    if (openAiResponse.status === 401) return json(502, { error: "מפתח ה-AI בשרת לא תקין" });
    if (openAiResponse.status === 429) return json(502, { error: "שירות הניתוח עמוס או שנגמרה היתרה. נסה שוב מאוחר יותר" });
    if (openAiResponse.status === 404 || code === "model_not_found") return json(502, { error: "מודל ה-AI שהוגדר לא זמין" });
    return json(502, { error: "שירות הניתוח החזיר שגיאה. נסה שוב" });
  }

  let payload: unknown;
  try {
    payload = await openAiResponse.json();
  } catch {
    return json(502, { error: "התקבלה תשובה לא תקינה משירות הניתוח" });
  }

  const output = extractOutputText(payload);
  if (output.kind === "refusal") return json(422, { error: "המודל סירב לנתח את התוכן הזה" });
  if (output.kind === "empty") return json(502, { error: "לא התקבלה תשובה משירות הניתוח. נסה שוב" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.text);
  } catch {
    return json(502, { error: "התשובה משירות הניתוח נקטעה. נסה שוב" });
  }
  const analysis = parseMealAnalysis(parsed);
  if (!analysis) return json(502, { error: "התשובה משירות הניתוח לא הייתה במבנה הצפוי. נסה שוב" });

  return json(200, { analysis, source: imageDataUrl ? "ai_photo" : "ai_text" });
}
