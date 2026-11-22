// The weekly insight editor: which findings are offered, what the AI editor is told, and how its
// answer is checked. Pure code; the server route does the call.

import type { Finding, InsightKind } from "./analyses.ts";

export const INSIGHT_KINDS: InsightKind[] = [
  "delayed_compensation",
  "weigh_in_conditions",
  "small_swap",
  "goal_reality",
  "outlier_days",
  "logging_blind_spots",
];

/** A new insight is offered at most this often. */
export const INSIGHT_INTERVAL_DAYS = 7;
/** A kind shown this recently is not repeated. */
const REPEAT_AFTER_DAYS = 21;
const MAX_CANDIDATES = 4;
const LIKED_BOOST = 0.15;

export type PastInsight = { kind: string; createdAt: string; feedback: "useful" | "not_relevant" | null };

/**
 * The findings worth offering this week, best first: kinds the user marked "not relevant" are dropped
 * for good, kinds shown in the last three weeks are skipped, and kinds marked "useful" rank higher.
 */
export function chooseCandidates(findings: Finding[], history: PastInsight[], now: Date): Finding[] {
  const disliked = new Set(history.filter((item) => item.feedback === "not_relevant").map((item) => item.kind));
  const liked = new Set(history.filter((item) => item.feedback === "useful").map((item) => item.kind));
  const recent = new Set(
    history
      .filter((item) => now.getTime() - new Date(item.createdAt).getTime() < REPEAT_AFTER_DAYS * 86_400_000)
      .map((item) => item.kind),
  );
  return findings
    .filter((finding) => !disliked.has(finding.kind) && !recent.has(finding.kind))
    .map((finding) => ({ finding, score: finding.strength + (liked.has(finding.kind) ? LIKED_BOOST : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.finding);
}

export function isInsightDue(latestCreatedAt: string | null, now: Date): boolean {
  if (latestCreatedAt === null) return true;
  return now.getTime() - new Date(latestCreatedAt).getTime() >= INSIGHT_INTERVAL_DAYS * 86_400_000;
}

// ------------------------------------------------------------------ request from the app

export type ComposeRequest = {
  candidates: Finding[];
  /** For Hebrew grammar: how to address the user. */
  sex: "male" | "female" | null;
  likedKinds: InsightKind[];
};

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || text.length > max ? null : text;
}

function cleanFacts(value: unknown): Record<string, string | number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 15) return null;
  const facts: Record<string, string | number> = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z_]{1,50}$/.test(key)) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) facts[key] = raw;
    else if (typeof raw === "string" && raw.length <= 120) facts[key] = raw;
    else return null;
  }
  return facts;
}

export function validateComposeRequest(body: unknown): { ok: true; value: ComposeRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "בקשה לא תקינה" };
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.candidates) || record.candidates.length === 0 || record.candidates.length > MAX_CANDIDATES) {
    return { ok: false, error: "בקשה לא תקינה" };
  }
  const candidates: Finding[] = [];
  for (const raw of record.candidates as unknown[]) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "בקשה לא תקינה" };
    const item = raw as Record<string, unknown>;
    const kind = item.kind as InsightKind;
    const title = cleanText(item.title, 120);
    const text = cleanText(item.text, 1200);
    const facts = cleanFacts(item.facts);
    const strength = typeof item.strength === "number" && Number.isFinite(item.strength) ? item.strength : null;
    if (!INSIGHT_KINDS.includes(kind) || !title || !text || !facts || strength === null) {
      return { ok: false, error: "בקשה לא תקינה" };
    }
    if (candidates.some((candidate) => candidate.kind === kind)) return { ok: false, error: "בקשה לא תקינה" };
    candidates.push({ kind, title, text, facts, strength: Math.max(0, Math.min(1.5, strength)) });
  }
  const sex = record.sex === "male" || record.sex === "female" ? record.sex : null;
  const likedKinds = Array.isArray(record.likedKinds)
    ? (record.likedKinds as unknown[]).filter((kind): kind is InsightKind => INSIGHT_KINDS.includes(kind as InsightKind))
    : [];
  return { ok: true, value: { candidates, sex, likedKinds } };
}

// ------------------------------------------------------------------ the AI editor

export const EDITOR_INSTRUCTIONS = [
  "You are the editor of a weekly personal insight in a Hebrew calorie and weight tracking app.",
  "The app has already analysed the user's own data. You receive candidate findings; each has a kind, verified facts (numbers computed by the app) and a plain draft.",
  "Pick exactly one finding: the one most likely to surprise this user and to help them, preferring kinds listed as liked.",
  "Write in natural, adult, respectful Hebrew, addressing the user in the second person with the grammatical gender given. No emojis, no exclamation marks, nothing childish or preachy, no praise or shaming.",
  "title: up to 60 characters, a crisp statement of what was found.",
  "body: 2 to 4 sentences, up to 420 characters: what was found with the key numbers, and a likely reason, worded as a possibility (כנראה, ייתכן).",
  "action: one concrete, realistic next step, up to 160 characters.",
  "Use only numbers that appear in the facts of the chosen finding; you may round them. Do not calculate new numbers and do not invent foods, days, events or causes that are not in the facts.",
  "You may suggest a lighter version of a food named in the facts in general terms, without numbers.",
  "Never advise eating below the user's daily target, skipping meals, fasting, extreme exercise or anything medical. Do not diagnose.",
  "If the facts mention the share of workout calories eaten back, do not tell the user to stop eating after workouts; suggest planning instead.",
].join("\n");

export function editorSchema(kinds: InsightKind[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "title", "body", "action"],
    properties: {
      kind: { type: "string", enum: kinds },
      title: { type: "string" },
      body: { type: "string" },
      action: { type: "string" },
    },
  };
}

export function editorInput(request: ComposeRequest): string {
  return JSON.stringify({
    address_user_as: request.sex === "female" ? "feminine" : "masculine",
    liked_kinds: request.likedKinds,
    candidates: request.candidates.map((candidate) => ({
      kind: candidate.kind,
      facts: candidate.facts,
      draft: candidate.text,
    })),
  });
}

export type ComposedInsight = { kind: InsightKind; title: string; body: string; action: string | null };

/** Checks the editor's answer: one of the offered kinds, texts within their limits. */
export function parseEditorOutput(text: string, candidates: Finding[]): ComposedInsight | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind as InsightKind;
  if (!candidates.some((candidate) => candidate.kind === kind)) return null;
  const title = cleanText(record.title, 90);
  const body = cleanText(record.body, 700);
  const action = cleanText(record.action, 260);
  if (!title || !body) return null;
  return { kind, title, body, action };
}

/** Used when the AI editor is not available: the strongest finding with its own wording. */
export function templateInsight(candidates: Finding[]): ComposedInsight | null {
  const top = candidates[0];
  return top ? { kind: top.kind, title: top.title, body: top.text, action: null } : null;
}
