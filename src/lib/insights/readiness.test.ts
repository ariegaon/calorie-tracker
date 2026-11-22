import { test } from "node:test";
import assert from "node:assert/strict";
import { countDistinctDays, insightReadiness, MIN_LOGGED_DAYS } from "./readiness.ts";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();

test("several entries on one day count as one logged day", () => {
  assert.equal(countDistinctDays([at(1, 8), at(1, 13), at(1, 20), at(2, 9), "junk"]), 2);
});

test("insights wait for enough logged days", () => {
  const fewDays = Array.from({ length: 5 }, (_, i) => at(i + 1, 12));
  const early = insightReadiness(fewDays, [at(1, 7)]);
  assert.deepEqual(early, { loggedDays: 5, weighIns: 1, ready: false, daysToGo: MIN_LOGGED_DAYS - 5 });

  const enough = Array.from({ length: MIN_LOGGED_DAYS }, (_, i) => at(i + 1, 12));
  assert.equal(insightReadiness(enough, []).ready, true);
  assert.equal(insightReadiness(enough, []).daysToGo, 0);
});
