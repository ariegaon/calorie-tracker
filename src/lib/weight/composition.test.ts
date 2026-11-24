import { test } from "node:test";
import assert from "node:assert/strict";
import { compositionSignal, describeChange } from "./composition.ts";

const END = 20100;
const waistAt = (daysAgo: number, cm: number) => ({ day: END - daysAgo, waistCm: cm, bodyFatPercent: null });

test("waist clearly down over three weeks or more: fat loss likely", () => {
  const signal = compositionSignal([waistAt(28, 94), waistAt(21, 93.6), waistAt(14, 93.1), waistAt(7, 92.8), waistAt(0, 92.4)], END);
  assert.equal(signal.verdict, "fat_loss_likely");
  assert.equal(signal.source, "waist");
  assert.ok(signal.waist && Math.abs(signal.waist.change - -1.6) < 0.05);
  assert.equal(describeChange(signal.waist!, 'ס"מ'), 'ירידה של 1.6 ס"מ ב-4 שבועות');
});

test("small changes within tape error are 'stable'; too few or too close measurements are not enough", () => {
  assert.equal(compositionSignal([waistAt(28, 94), waistAt(14, 94.4), waistAt(0, 93.6)], END).verdict, "stable");
  assert.equal(compositionSignal([waistAt(28, 94), waistAt(0, 91)], END).verdict, "not_enough_data");
  assert.equal(compositionSignal([waistAt(14, 94), waistAt(7, 93), waistAt(0, 92)], END).verdict, "not_enough_data");
  // Old measurements outside the six-week window do not count.
  assert.equal(compositionSignal([waistAt(80, 99), waistAt(60, 97), waistAt(0, 92)], END).verdict, "not_enough_data");
});

test("body fat is used when there is no waist trend", () => {
  const fat = (daysAgo: number, pct: number) => ({ day: END - daysAgo, waistCm: null, bodyFatPercent: pct });
  const signal = compositionSignal([fat(30, 25), fat(20, 24.4), fat(10, 23.9), fat(0, 23.6)], END);
  assert.equal(signal.verdict, "fat_loss_likely");
  assert.equal(signal.source, "body_fat");
});
