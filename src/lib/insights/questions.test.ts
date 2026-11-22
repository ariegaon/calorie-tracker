import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAnswer, questionInput, validateAskRequest } from "./questions.ts";

test("ask request: a question, the data and up to four earlier exchanges", () => {
  const ok = validateAskRequest({
    question: "  מה המגמה?  ",
    context: { days: [] },
    history: [1, 2, 3, 4, 5].map((n) => ({ question: `ש${n}`, answer: `ת${n}` })),
    insightId: "not-a-uuid",
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.question, "מה המגמה?");
  assert.deepEqual(ok.value.history.map((item) => item.question), ["ש2", "ש3", "ש4", "ש5"]);
  assert.equal(ok.value.insightId, null);

  assert.equal(validateAskRequest({ question: "", context: {} }).ok, false);
  assert.equal(validateAskRequest({ question: "x".repeat(501), context: {} }).ok, false);
  assert.equal(validateAskRequest({ question: "שאלה", context: [] }).ok, false);
  assert.equal(validateAskRequest({ question: "שאלה", context: { big: "x".repeat(90_000) } }).ok, false);
});

test("the model gets the data, the conversation so far and the question", () => {
  const text = questionInput({ question: "ומה עם שבת?", context: { a: 1 }, history: [{ question: "באיזה יום הכי הרבה?", answer: "שישי" }], insightId: null });
  assert.ok(text.includes('{"a":1}'));
  assert.ok(text.indexOf("Q: באיזה יום") < text.indexOf("Question: ומה עם שבת?"));
});

test("answers are cleaned to plain text", () => {
  assert.equal(cleanAnswer("## כותרת\n**חשוב**: כן\n\n\n\nסוף"), "כותרת\nחשוב: כן\n\nסוף");
  assert.equal(cleanAnswer("   "), null);
  assert.equal(cleanAnswer("א".repeat(5000))?.length, 4000);
});
