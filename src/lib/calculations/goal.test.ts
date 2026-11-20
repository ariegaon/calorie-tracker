import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paceForTargetDate,
  remainingToday,
  safeWeeklyLimitKg,
  snackAllowanceForDay,
  suggestedSnackAllowance,
} from "./goal.ts";

const today = new Date(2026, 10, 20, 17, 30); // 20.11.2026, late in the day

test("pace that reaches the target weight exactly on the date", () => {
  // 78 -> 74 kg in 10 weeks: 0.4 kg a week
  const pace = paceForTargetDate(78, 74, today, "2027-01-29");
  assert.equal(pace.status, "ok");
  if (pace.status !== "ok") return;
  assert.equal(pace.daysLeft, 70);
  assert.ok(Math.abs(pace.weeklyKg - -0.4) < 1e-9);
});

test("a date that asks for more than 1% of body weight a week is capped, with a realistic date", () => {
  // 78 -> 70 kg in 4 weeks would be 2 kg a week; the limit is 0.78 kg a week
  const pace = paceForTargetDate(78, 70, today, "2026-12-18");
  assert.equal(pace.status, "capped");
  if (pace.status !== "capped") return;
  assert.ok(Math.abs(pace.weeklyKg - -0.78) < 1e-9);
  assert.ok(Math.abs(pace.requestedWeeklyKg - -2) < 1e-9);
  // 8 kg / 0.78 kg a week = 10.26 weeks = 72 days -> 31.1.2027
  assert.equal(pace.realisticDate, "2027-01-31");
});

test("gaining is capped at 0.5 kg a week", () => {
  const pace = paceForTargetDate(60, 64, today, "2026-12-04"); // 4 kg in 2 weeks
  assert.equal(pace.status, "capped");
  if (pace.status === "capped") assert.equal(pace.weeklyKg, 0.5);
  assert.equal(safeWeeklyLimitKg(60, false), 0.5);
  assert.equal(safeWeeklyLimitKg(100, true), -1);
});

test("at the target weight the plan is maintenance", () => {
  const pace = paceForTargetDate(74.1, 74, today, "2027-01-29");
  assert.equal(pace.status, "reached");
  if (pace.status === "reached") assert.equal(pace.weeklyKg, 0);
});

test("a date today, in the past or malformed cannot be used", () => {
  assert.equal(paceForTargetDate(78, 74, today, "2026-11-20").status, "past");
  assert.equal(paceForTargetDate(78, 74, today, "2026-11-01").status, "past");
  assert.equal(paceForTargetDate(78, 74, today, "20.1.2027").status, "past");
});

test("remaining to eat adds the counted workout calories to the target", () => {
  assert.deepEqual(remainingToday(1664, 384, 0), { budgetKcal: 1664, remainingKcal: 1280, workoutKcal: 0 });
  assert.deepEqual(remainingToday(1664, 384, 400), { budgetKcal: 2064, remainingKcal: 1680, workoutKcal: 400 });
  assert.equal(remainingToday(1664, 1900, 0).remainingKcal, -236); // over
  assert.equal(remainingToday(1664, 0, -10).workoutKcal, 0);
});

test("suggested snack allowance is 7% of the target, rounded, within 50-300", () => {
  assert.equal(suggestedSnackAllowance(1664), 120); // 116.5 -> 120
  assert.equal(suggestedSnackAllowance(2500), 180);
  assert.equal(suggestedSnackAllowance(500), 50);
  assert.equal(suggestedSnackAllowance(6000), 300);
});

test("the snack allowance applies unless it is off or the day is marked as fully logged", () => {
  assert.equal(snackAllowanceForDay(150, false), 150);
  assert.equal(snackAllowanceForDay(150, true), 0);
  assert.equal(snackAllowanceForDay(null, false), 0);
  assert.equal(snackAllowanceForDay(0, false), 0);
  assert.equal(snackAllowanceForDay(5000, false), 800);
});
