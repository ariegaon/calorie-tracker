import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DESCRIPTION_LENGTH,
  MEAL_ANALYSIS_SCHEMA,
  extractOutputText,
  parseMealAnalysis,
  scaleNutrition,
  validateAnalyzeRequest,
} from "./meal.ts";
import { validateMeal, type MealForm } from "../day/entries.ts";

// Synthetic data only.

const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

test("a request needs a description, a photo, or both", () => {
  assert.equal(validateAnalyzeRequest({}).ok, false);
  assert.equal(validateAnalyzeRequest({ description: "   " }).ok, false);
  assert.equal(validateAnalyzeRequest(null).ok, false);
  assert.equal(validateAnalyzeRequest("text").ok, false);

  const textOnly = validateAnalyzeRequest({ description: " סלט טונה " });
  assert.deepEqual(textOnly, { ok: true, value: { description: "סלט טונה", imageDataUrl: null } });

  const photoOnly = validateAnalyzeRequest({ imageDataUrl: TINY_JPEG });
  assert.equal(photoOnly.ok, true);
  if (photoOnly.ok) assert.equal(photoOnly.value.description, "");
});

test("requests with bad types, long text or unsupported images are rejected", () => {
  assert.equal(validateAnalyzeRequest({ description: 5 }).ok, false);
  assert.equal(validateAnalyzeRequest({ description: "א".repeat(MAX_DESCRIPTION_LENGTH + 1) }).ok, false);
  assert.equal(validateAnalyzeRequest({ imageDataUrl: 7 }).ok, false);
  assert.equal(validateAnalyzeRequest({ imageDataUrl: "https://example.com/meal.jpg" }).ok, false);
  assert.equal(validateAnalyzeRequest({ imageDataUrl: "data:image/gif;base64,R0lGOD==" }).ok, false);
  assert.equal(validateAnalyzeRequest({ imageDataUrl: "data:image/jpeg;base64,not base64!" }).ok, false);
  assert.equal(validateAnalyzeRequest({ imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).ok, false);
});

test("the output schema is strict: every property required and nothing extra allowed", () => {
  assert.equal(MEAL_ANALYSIS_SCHEMA.additionalProperties, false);
  assert.deepEqual([...MEAL_ANALYSIS_SCHEMA.required].sort(), Object.keys(MEAL_ANALYSIS_SCHEMA.properties).sort());
  const item = MEAL_ANALYSIS_SCHEMA.properties.items.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
});

const modelOutput = {
  is_food: true,
  meal_name: "עוף עם אורז",
  items: [
    {
      name: "חזה עוף",
      quantity_g: 200.4,
      preparation: "צלוי",
      calories_kcal: 330.2,
      protein_g: 62.04,
      carbs_g: 0,
      fat_g: 7.16,
      fiber_g: null,
      confidence: "high",
      note: null,
    },
    {
      name: "אורז לבן",
      quantity_g: 180,
      preparation: "מבושל",
      calories_kcal: 234,
      protein_g: 4.3,
      carbs_g: 51,
      fat_g: 0.5,
      fiber_g: 0.6,
      confidence: "medium",
      note: "הכמות מוערכת לפי התמונה",
    },
  ],
  clarification: null,
};

test("a well-formed analysis is converted and rounded", () => {
  const analysis = parseMealAnalysis(modelOutput);
  assert.ok(analysis);
  assert.equal(analysis.isFood, true);
  assert.equal(analysis.mealName, "עוף עם אורז");
  assert.equal(analysis.items.length, 2);
  assert.deepEqual(analysis.items[0], {
    name: "חזה עוף",
    quantityG: 200,
    preparation: "צלוי",
    caloriesKcal: 330,
    proteinG: 62,
    carbsG: 0,
    fatG: 7.2,
    fiberG: null,
    confidence: "high",
    note: null,
  });
  assert.equal(analysis.items[1].note, "הכמות מוערכת לפי התמונה");
});

test("bad items are dropped and odd values fall back to safe ones", () => {
  const analysis = parseMealAnalysis({
    is_food: true,
    meal_name: "",
    items: [
      { name: "", calories_kcal: 100 },
      { name: "בלי קלוריות" },
      { name: "שלילי", calories_kcal: -5 },
      "not an object",
      { name: "פיצה", quantity_g: 0, calories_kcal: 99999, protein_g: "12", confidence: "certain", note: 3 },
    ],
    clarification: "  ",
  });
  assert.ok(analysis);
  assert.equal(analysis.items.length, 1);
  assert.deepEqual(analysis.items[0], {
    name: "פיצה",
    quantityG: null,
    preparation: null,
    caloriesKcal: 5000,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: null,
    confidence: "low",
    note: null,
  });
  assert.equal(analysis.mealName, "פיצה");
  assert.equal(analysis.clarification, null);
});

test("no usable items means it is not treated as food", () => {
  const notFood = parseMealAnalysis({ is_food: false, meal_name: "", items: [], clarification: null });
  assert.ok(notFood);
  assert.equal(notFood.isFood, false);

  const emptied = parseMealAnalysis({ is_food: true, meal_name: "x", items: [{ name: "" }], clarification: null });
  assert.ok(emptied);
  assert.equal(emptied.isFood, false);
  assert.equal(emptied.items.length, 0);
});

test("an unusable shape returns null", () => {
  assert.equal(parseMealAnalysis(null), null);
  assert.equal(parseMealAnalysis("text"), null);
  assert.equal(parseMealAnalysis({ items: [] }), null);
  assert.equal(parseMealAnalysis({ is_food: true, items: "none" }), null);
});

test("output text is found among other output items", () => {
  const response = {
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: '{"a":' }, { type: "output_text", text: "1}" }] },
    ],
  };
  assert.deepEqual(extractOutputText(response), { kind: "text", text: '{"a":1}' });
});

test("refusals and empty responses are told apart", () => {
  assert.deepEqual(extractOutputText({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }), {
    kind: "refusal",
  });
  assert.deepEqual(extractOutputText({ output: [] }), { kind: "empty" });
  assert.deepEqual(extractOutputText({}), { kind: "empty" });
  assert.deepEqual(extractOutputText(null), { kind: "empty" });
});

test("nutrition scales in proportion to the corrected quantity", () => {
  const basis = { quantityG: 200, caloriesKcal: 330, proteinG: 62, carbsG: 0, fatG: 7.2 };
  assert.deepEqual(scaleNutrition(basis, 100), { quantityG: 100, caloriesKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 });
  assert.deepEqual(scaleNutrition(basis, 300), { quantityG: 300, caloriesKcal: 495, proteinG: 93, carbsG: 0, fatG: 10.8 });
  assert.equal(scaleNutrition(basis, 0), null);
  assert.equal(scaleNutrition(basis, Number.NaN), null);
  assert.equal(scaleNutrition({ ...basis, quantityG: 0 }, 100), null);
});

// ------------------------------------------------------------------ meal form with several items

const mealForm: MealForm = {
  name: "",
  mealType: "lunch",
  dateTime: "2026-11-12T13:00",
  notes: "",
  items: [
    { name: "חזה עוף", quantityG: "200", calories: "330", protein: "62", carbs: "0", fat: "7.2" },
    { name: "אורז לבן", quantityG: "", calories: "234", protein: "", carbs: "51", fat: "" },
  ],
};

test("a meal with several items is validated item by item", () => {
  const result = validateMeal(mealForm);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.name, "חזה עוף, אורז לבן");
  assert.equal(result.values.items.length, 2);
  assert.deepEqual(result.values.items[1], {
    name: "אורז לבן",
    quantityG: null,
    caloriesKcal: 234,
    proteinG: 0,
    carbsG: 51,
    fatG: 0,
  });
});

test("a typed meal name wins over the generated one", () => {
  const result = validateMeal({ ...mealForm, name: "ארוחת צהריים בעבודה" });
  assert.equal(result.ok && result.values.name, "ארוחת צהריים בעבודה");
});

test("item errors are reported at the item's position", () => {
  const result = validateMeal({
    ...mealForm,
    items: [mealForm.items[0], { name: "", quantityG: "-1", calories: "", protein: "x", carbs: "", fat: "" }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors.itemErrors[0], {});
  assert.deepEqual(Object.keys(result.errors.itemErrors[1]).sort(), ["calories", "name", "protein", "quantityG"]);
});

test("a meal needs at least one item and a valid time", () => {
  const empty = validateMeal({ ...mealForm, items: [] });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.ok(empty.errors.items);

  const noTime = validateMeal({ ...mealForm, dateTime: "" });
  assert.equal(noTime.ok, false);
  if (!noTime.ok) assert.ok(noTime.errors.dateTime);
});
