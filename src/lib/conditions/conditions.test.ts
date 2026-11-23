import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionNameError, conditionOptions, moveCondition, normalizeConditionName, type ConditionRow } from "./conditions.ts";

const rows: ConditionRow[] = [
  { id: "a", name: "בוקר, לפני אוכל", position: 0, hidden: false },
  { id: "b", name: "ערב", position: 2, hidden: true },
  { id: "c", name: "אחרי שחייה", position: 1, hidden: false },
];

test("names are trimmed, must be new and short, and the list has a cap", () => {
  assert.equal(normalizeConditionName("  אחרי   ריצה "), "אחרי ריצה");
  assert.equal(conditionNameError("", rows), "יש לכתוב שם");
  assert.equal(conditionNameError("x".repeat(41), rows), "עד 40 תווים");
  assert.equal(conditionNameError(" ערב ", rows), "כבר יש תנאי בשם הזה");
  assert.equal(conditionNameError("ערב", rows, "b"), null); // renaming a row to its own name
  assert.equal(conditionNameError("צהריים", rows), null);
  const full = Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: `תנאי ${i}`, position: i, hidden: false }));
  assert.ok(conditionNameError("עוד אחד", full)?.includes("עד 15"));
  assert.equal(conditionNameError("שם חדש", full, "3"), null); // renaming is not adding
});

test("form options: visible conditions in order, plus the weigh-in's own hidden or old condition", () => {
  assert.deepEqual(conditionOptions(rows, ""), ["בוקר, לפני אוכל", "אחרי שחייה"]);
  assert.deepEqual(conditionOptions(rows, "ערב"), ["בוקר, לפני אוכל", "אחרי שחייה", "ערב"]);
  assert.deepEqual(conditionOptions(rows, "ישן"), ["בוקר, לפני אוכל", "אחרי שחייה", "ישן"]);
});

test("moving a condition swaps it with its neighbour and renumbers", () => {
  assert.deepEqual(moveCondition(rows, "c", -1), [
    { id: "c", position: 0 },
    { id: "a", position: 1 },
  ]);
  assert.deepEqual(moveCondition(rows, "a", -1), []); // already first
  assert.deepEqual(moveCondition(rows, "b", 1), []); // already last
});
