import { test } from "node:test";
import assert from "node:assert/strict";
import { chipsForDay, cleanNote, tagNameError, type TagRow } from "./tags.ts";

const tags: TagRow[] = [
  { id: "a", name: "אירוע", position: 0, hidden: false },
  { id: "b", name: "חולה", position: 2, hidden: true },
  { id: "c", name: "שינה גרועה", position: 1, hidden: false },
];

test("tag names: required, short, unique, and the list has a cap", () => {
  assert.equal(tagNameError(" ", tags), "יש לכתוב שם");
  assert.equal(tagNameError("x".repeat(31), tags), "עד 30 תווים");
  assert.equal(tagNameError("אירוע", tags), "כבר יש תגית בשם הזה");
  assert.equal(tagNameError("אירוע", tags, "a"), null);
  assert.equal(tagNameError("טיול", tags), null);
  const full = Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: `ת${i}`, position: i, hidden: false }));
  assert.ok(tagNameError("עוד", full)?.includes("עד 15"));
});

test("chips: visible tags in order; a hidden tag shows only when it is marked that day; several marks at once", () => {
  assert.deepEqual(chipsForDay(tags, []).map((chip) => chip.tag.name), ["אירוע", "שינה גרועה"]);
  const chips = chipsForDay(tags, [
    { tagId: "a", note: "חתונה" },
    { tagId: "b", note: null },
  ]);
  assert.deepEqual(
    chips.map((chip) => [chip.tag.name, chip.mark?.note ?? null, chip.mark !== null]),
    [
      ["אירוע", "חתונה", true],
      ["שינה גרועה", null, false],
      ["חולה", null, true],
    ],
  );
});

test("notes are trimmed and capped", () => {
  assert.equal(cleanNote("  חתונה   של דני "), "חתונה של דני");
  assert.equal(cleanNote("   "), null);
  assert.equal(cleanNote("א".repeat(150))?.length, 100);
});
