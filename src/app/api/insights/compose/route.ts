import { authenticate, insertRows, json, selectRows, type Access } from "@/lib/server/supabase";
import { extractOutputText } from "@/lib/ai/meal";
import {
  EDITOR_INSTRUCTIONS,
  editorInput,
  editorSchema,
  isInsightDue,
  parseEditorOutput,
  templateInsight,
  validateComposeRequest,
  type ComposedInsight,
  type ComposeRequest,
} from "@/lib/insights/editor";

// Server-only: the OpenAI key never reaches the browser. The findings and their numbers were computed
// by the app from the user's own data; the model only chooses one and words it.
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "gpt-6.1-terra";
/** At most this many editor calls per user in six days (one a week, plus a retry). */
const WEEKLY_EDITOR_LIMIT = 2;

async function recentInsightUsage(access: Access): Promise<number> {
  const since = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const rows = await selectRows<{ id: string }>(
    access,
    "ai_usage",
    `select=id&kind=eq.insight&created_at=gte.${encodeURIComponent(since)}`,
  );
  return rows.length;
}

async function compose(request: ComposeRequest): Promise<ComposedInsight | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const kinds = request.candidates.map((candidate) => candidate.kind);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: EDITOR_INSTRUCTIONS,
        input: [{ role: "user", content: [{ type: "input_text", text: editorInput(request) }] }],
        text: { format: { type: "json_schema", name: "weekly_insight", strict: true, schema: editorSchema(kinds) } },
        max_output_tokens: 3000,
        store: false,
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("insights: model returned an error", response.status);
      return null;
    }
    const output = extractOutputText(await response.json());
    return output.kind === "text" ? parseEditorOutput(output.text, request.candidates) : null;
  } catch (error) {
    console.error("insights: request to the model failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await authenticate(request);
  if (access instanceof Response) return access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "בקשה לא תקינה" });
  }
  const validated = validateComposeRequest(body);
  if (!validated.ok) return json(400, { error: validated.error });

  try {
    // One insight a week: another device may have written this week's already.
    const latest = await selectRows<{ created_at: string }>(
      access,
      "insights",
      "select=created_at&order=created_at.desc&limit=1",
    );
    if (!isInsightDue(latest[0]?.created_at ?? null, new Date())) return json(409, { error: "כבר יש תובנה לשבוע הזה" });

    if (validated.value.useAi) {
      if ((await recentInsightUsage(access)) >= WEEKLY_EDITOR_LIMIT) {
        return json(429, { error: "נוצרו כבר תובנות השבוע" });
      }
      await insertRows(access, "ai_usage", [{ user_id: access.userId, kind: "insight" }]);
    }
  } catch {
    return json(502, { error: "לא הצלחנו לבדוק את הנתונים. נסה שוב" });
  }

  // The AI editor words the finding; if it is unavailable the finding's own wording is used.
  const fromAi = validated.value.useAi ? await compose(validated.value) : null;
  const insight = fromAi ?? templateInsight(validated.value.candidates);
  if (!insight) return json(500, { error: "לא נמצאה תובנה" });
  const facts = validated.value.candidates.find((candidate) => candidate.kind === insight.kind)?.facts ?? {};

  try {
    await insertRows(access, "insights", [
      {
        user_id: access.userId,
        kind: insight.kind,
        title: insight.title,
        body: insight.body,
        action: insight.action,
        facts,
        source: fromAi ? "ai" : "template",
      },
    ]);
  } catch {
    return json(502, { error: "שמירת התובנה נכשלה. נסה שוב" });
  }
  return json(200, { ok: true, source: fromAi ? "ai" : "template" });
}
