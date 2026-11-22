import { test } from "node:test";
import assert from "node:assert/strict";
import type { Finding } from "./analyses.ts";
import { chooseCandidates, isInsightDue, parseEditorOutput, templateInsight, validateComposeRequest } from "./editor.ts";

const now = new Date(2026, 10, 22, 20, 0);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

function finding(kind: Finding["kind"], strength: number): Finding {
  return { kind, strength, title: `כותרת ${kind}`, text: `טקסט ${kind}`, facts: { value: 1 } };
}

test("candidates: disliked kinds are dropped, recent kinds wait three weeks, liked kinds rank higher", () => {
  const findings = [finding("outlier_days", 0.9), finding("small_swap", 0.7), finding("goal_reality", 0.6), finding("delayed_compensation", 0.5)];
  const chosen = chooseCandidates(
    findings,
    [
      { kind: "outlier_days", createdAt: daysAgo(40), feedback: "not_relevant" },
      { kind: "small_swap", createdAt: daysAgo(7), feedback: null },
      { kind: "delayed_compensation", createdAt: daysAgo(60), feedback: "useful" },
    ],
    now,
  );
  assert.deepEqual(
    chosen.map((item) => item.kind),
    ["delayed_compensation", "goal_reality"], // 0.5 + 0.15 > 0.6
  );
});

test("a new insight is due a week after the previous one", () => {
  assert.equal(isInsightDue(null, now), true);
  assert.equal(isInsightDue(daysAgo(6), now), false);
  assert.equal(isInsightDue(daysAgo(7), now), true);
});

test("compose request: accepts verified findings and rejects anything else", () => {
  const ok = validateComposeRequest({ candidates: [finding("small_swap", 0.7)], sex: "female", likedKinds: ["goal_reality", "nope"] });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.sex, "female");
    assert.deepEqual(ok.value.likedKinds, ["goal_reality"]);
  }
  assert.equal(validateComposeRequest({ candidates: [] }).ok, false);
  assert.equal(validateComposeRequest({ candidates: [{ ...finding("small_swap", 1), kind: "other" }] }).ok, false);
  assert.equal(validateComposeRequest({ candidates: [{ ...finding("small_swap", 1), facts: { "Bad Key": 1 } }] }).ok, false);
  assert.equal(validateComposeRequest({ candidates: [finding("small_swap", 1), finding("small_swap", 0.5)] }).ok, false);
});

test("editor output must name an offered kind and keep within limits", () => {
  const offered = [finding("small_swap", 0.7)];
  assert.deepEqual(parseEditorOutput(JSON.stringify({ kind: "small_swap", title: "כותרת", body: "גוף", action: "צעד" }), offered), {
    kind: "small_swap",
    title: "כותרת",
    body: "גוף",
    action: "צעד",
  });
  assert.equal(parseEditorOutput(JSON.stringify({ kind: "goal_reality", title: "א", body: "ב", action: "" }), offered), null);
  assert.equal(parseEditorOutput("not json", offered), null);
  assert.equal(parseEditorOutput(JSON.stringify({ kind: "small_swap", title: "", body: "ב", action: "" }), offered)?.title, undefined);
  assert.deepEqual(templateInsight(offered), { kind: "small_swap", title: "כותרת small_swap", body: "טקסט small_swap", action: null });
});
