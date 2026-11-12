import { test } from "node:test";
import assert from "node:assert/strict";
import { ageInYears, parseNumber, validateProfile, type ProfileForm } from "./profile.ts";

// Synthetic data only.
const TODAY = new Date(2026, 10, 12); // 12 Nov 2026, local time

const valid: ProfileForm = {
  displayName: "בדיקה",
  sexForBmr: "male",
  birthDate: "1990-05-20",
  heightCm: "180",
  startWeightKg: "90",
  targetWeightKg: "84",
  activityFactor: "1.35",
  weeklyGoalKg: "-0.5",
  proteinGoalG: "140",
  waterGoalMl: "2500",
};

test("parseNumber accepts dot and comma decimals and rejects junk", () => {
  assert.equal(parseNumber("82"), 82);
  assert.equal(parseNumber(" 82.5 "), 82.5);
  assert.equal(parseNumber("82,5"), 82.5);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("82kg"), null);
  assert.equal(parseNumber("1e3"), null);
});

test("ageInYears counts full years around the birthday", () => {
  assert.equal(ageInYears("1990-11-12", TODAY), 36);
  assert.equal(ageInYears("1990-11-13", TODAY), 35);
  assert.equal(ageInYears("1990-02-30", TODAY), null);
  assert.equal(ageInYears("20-05-1990", TODAY), null);
});

test("a valid form passes and values are converted to numbers", () => {
  const result = validateProfile(valid, TODAY);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.values, {
    displayName: "בדיקה",
    sexForBmr: "male",
    birthDate: "1990-05-20",
    heightCm: 180,
    startWeightKg: 90,
    targetWeightKg: 84,
    activityFactor: 1.35,
    weeklyGoalKg: -0.5,
    proteinGoalG: 140,
    waterGoalMl: 2500,
  });
});

test("optional fields may be empty", () => {
  const result = validateProfile({ ...valid, displayName: " ", proteinGoalG: "" }, TODAY);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.displayName, null);
  assert.equal(result.values.proteinGoalG, null);
});

test("missing and out-of-range fields are reported per field", () => {
  const result = validateProfile(
    { ...valid, sexForBmr: "", birthDate: "", heightCm: "50", startWeightKg: "abc", waterGoalMl: "" },
    TODAY,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(Object.keys(result.errors).sort(), [
    "birthDate",
    "heightCm",
    "sexForBmr",
    "startWeightKg",
    "waterGoalMl",
  ]);
});

test("age limits are enforced", () => {
  assert.equal(validateProfile({ ...valid, birthDate: "2010-01-01" }, TODAY).ok, false);
  assert.equal(validateProfile({ ...valid, birthDate: "2008-11-12" }, TODAY).ok, true);
  assert.equal(validateProfile({ ...valid, birthDate: "2008-11-13" }, TODAY).ok, false);
});

test("activity factor and weekly pace must be one of the offered options", () => {
  assert.equal(validateProfile({ ...valid, activityFactor: "1.9" }, TODAY).ok, false);
  assert.equal(validateProfile({ ...valid, weeklyGoalKg: "-2" }, TODAY).ok, false);
});

test("pace must point toward the target weight", () => {
  const gainWhileTargetLower = validateProfile({ ...valid, weeklyGoalKg: "0.25" }, TODAY);
  assert.equal(gainWhileTargetLower.ok, false);
  if (!gainWhileTargetLower.ok) assert.ok(gainWhileTargetLower.errors.weeklyGoalKg);

  const lossWhileTargetHigher = validateProfile({ ...valid, targetWeightKg: "95" }, TODAY);
  assert.equal(lossWhileTargetHigher.ok, false);

  assert.equal(validateProfile({ ...valid, weeklyGoalKg: "0" }, TODAY).ok, true);
});
