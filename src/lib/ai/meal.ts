// Meal analysis by an AI model: request validation, the output schema, and checking of what comes back.
// Pure code with no imports. Everything the model returns is an estimate and is treated as untrusted input.

export const MAX_DESCRIPTION_LENGTH = 600;
/** Upper bound for the base64 image payload (about 3 MB of image data). */
export const MAX_IMAGE_DATA_URL_LENGTH = 4_200_000;
export const DAILY_ANALYSIS_LIMIT = 40;

// ------------------------------------------------------------------ request

export type AnalyzeRequest = {
  description: string;
  imageDataUrl: string | null;
};

export type AnalyzeRequestValidation = { ok: true; value: AnalyzeRequest } | { ok: false; error: string };

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export function validateAnalyzeRequest(body: unknown): AnalyzeRequestValidation {
  if (typeof body !== "object" || body === null) return { ok: false, error: "בקשה לא תקינה" };
  const record = body as Record<string, unknown>;

  const rawDescription = record.description;
  if (rawDescription !== undefined && rawDescription !== null && typeof rawDescription !== "string") {
    return { ok: false, error: "התיאור צריך להיות טקסט" };
  }
  const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `התיאור ארוך מדי (עד ${MAX_DESCRIPTION_LENGTH} תווים)` };
  }

  const rawImage = record.imageDataUrl;
  let imageDataUrl: string | null = null;
  if (rawImage !== undefined && rawImage !== null) {
    if (typeof rawImage !== "string") return { ok: false, error: "התמונה לא תקינה" };
    if (rawImage.length > MAX_IMAGE_DATA_URL_LENGTH) return { ok: false, error: "התמונה גדולה מדי" };
    if (!IMAGE_DATA_URL.test(rawImage)) return { ok: false, error: "סוג התמונה לא נתמך. אפשר JPEG, PNG או WebP" };
    imageDataUrl = rawImage;
  }

  if (description === "" && imageDataUrl === null) {
    return { ok: false, error: "יש לצלם את הארוחה או לתאר אותה במילים" };
  }

  return { ok: true, value: { description, imageDataUrl } };
}

// ------------------------------------------------------------------ model instructions and schema

export const MEAL_ANALYSIS_INSTRUCTIONS = `You estimate the nutritional content of a meal for a personal food diary.
You receive a photo of the meal, a short description written by the user, or both.

Rules:
- Write every name and note in Hebrew.
- List each distinct food as its own item. Estimate the eaten weight in grams (millilitres for liquids count as grams).
- When the user's description states a quantity or an ingredient, trust it over what the photo suggests.
- Include what is easy to miss: cooking oil, butter, sauces, dressings, sugar and toppings. Add them as separate items when they are significant.
- State the preparation method when it can be told (cooked, baked, fried, grilled, raw).
- Give calories in kcal and protein, carbohydrates, fat and fibre in grams, for the estimated quantity, not per 100 g.
- Confidence is "high" only when the food and its quantity are clear; "medium" when one of them is a guess; "low" when both are.
- In "note", say briefly what is uncertain about the item, or null when nothing is.
- If foods cannot be told apart or a quantity is very unclear, still give your best estimate and put one short question for the user in "clarification". Otherwise set it to null.
- If the input does not show or describe food or drink, set is_food to false and return an empty items list.
- Never present a guess as a measurement. Do not give advice about dieting.`;

export const MEAL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_food", "meal_name", "items", "clarification"],
  properties: {
    is_food: { type: "boolean" },
    meal_name: { type: "string", description: "Short Hebrew name for the whole meal" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "quantity_g",
          "preparation",
          "calories_kcal",
          "protein_g",
          "carbs_g",
          "fat_g",
          "fiber_g",
          "confidence",
          "note",
        ],
        properties: {
          name: { type: "string" },
          quantity_g: { type: "number" },
          preparation: { type: ["string", "null"] },
          calories_kcal: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
          fiber_g: { type: ["number", "null"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          note: { type: ["string", "null"] },
        },
      },
    },
    clarification: { type: ["string", "null"] },
  },
} as const;

// ------------------------------------------------------------------ response

export type Confidence = "low" | "medium" | "high";

export type AnalyzedItem = {
  name: string;
  quantityG: number | null;
  preparation: string | null;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  confidence: Confidence;
  note: string | null;
};

export type MealAnalysis = {
  isFood: boolean;
  mealName: string;
  items: AnalyzedItem[];
  clarification: string | null;
};

const MAX_ITEMS = 20;

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean === "" ? null : clean.slice(0, maxLength);
}

function amount(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(value, max);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Checks and cleans the model's JSON. Items without a name or calories are dropped,
 * numbers are clamped to sane ranges, and anything unexpected falls back to a safe value.
 * Returns null when the shape is not usable at all.
 */
export function parseMealAnalysis(raw: unknown): MealAnalysis | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const isFoodFlag = record.is_food;
  const rawItems = record.items;
  if (typeof isFoodFlag !== "boolean" || !Array.isArray(rawItems)) return null;

  const items: AnalyzedItem[] = [];
  for (const entry of rawItems.slice(0, MAX_ITEMS) as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const name = text(item.name, 80);
    const calories = amount(item.calories_kcal, 5000);
    if (name === null || calories === null) continue;
    const quantity = amount(item.quantity_g, 5000);
    const fiber = amount(item.fiber_g, 200);
    const rawConfidence = item.confidence;
    const confidence: Confidence =
      rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low" ? rawConfidence : "low";
    items.push({
      name,
      quantityG: quantity === null || quantity === 0 ? null : round(quantity, 0),
      preparation: text(item.preparation, 40),
      caloriesKcal: round(calories, 0),
      proteinG: round(amount(item.protein_g, 500) ?? 0, 1),
      carbsG: round(amount(item.carbs_g, 1000) ?? 0, 1),
      fatG: round(amount(item.fat_g, 500) ?? 0, 1),
      fiberG: fiber === null ? null : round(fiber, 1),
      confidence,
      note: text(item.note, 200),
    });
  }

  const isFood = isFoodFlag && items.length > 0;
  return {
    isFood,
    mealName: text(record.meal_name, 80) ?? (items[0]?.name ?? ""),
    items: isFood ? items : [],
    clarification: text(record.clarification, 300),
  };
}

export type ExtractedOutput = { kind: "text"; text: string } | { kind: "refusal" } | { kind: "empty" };

/** Pulls the assistant's text out of a Responses API result. */
export function extractOutputText(response: unknown): ExtractedOutput {
  if (typeof response !== "object" || response === null) return { kind: "empty" };
  const output = (response as Record<string, unknown>).output;
  if (!Array.isArray(output)) return { kind: "empty" };

  let refused = false;
  const parts: string[] = [];
  for (const item of output as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const contents = record.content;
    if (record.type !== "message" || !Array.isArray(contents)) continue;
    for (const content of contents as unknown[]) {
      if (typeof content !== "object" || content === null) continue;
      const part = content as Record<string, unknown>;
      if (part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
      if (part.type === "refusal") refused = true;
    }
  }

  if (parts.length > 0) return { kind: "text", text: parts.join("") };
  return refused ? { kind: "refusal" } : { kind: "empty" };
}

export const CONFIDENCE_SCORE: Record<Confidence, number> = { low: 0.3, medium: 0.6, high: 0.85 };

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "ביטחון נמוך",
  medium: "ביטחון בינוני",
  high: "ביטחון גבוה",
};

// ------------------------------------------------------------------ rescaling when the user corrects a quantity

export type NutritionBasis = {
  quantityG: number;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** Nutrition values for a new quantity, in proportion to a known quantity of the same food. */
export function scaleNutrition(basis: NutritionBasis, newQuantityG: number): NutritionBasis | null {
  if (!(basis.quantityG > 0) || !Number.isFinite(newQuantityG) || newQuantityG <= 0) return null;
  const ratio = newQuantityG / basis.quantityG;
  return {
    quantityG: newQuantityG,
    caloriesKcal: round(basis.caloriesKcal * ratio, 0),
    proteinG: round(basis.proteinG * ratio, 1),
    carbsG: round(basis.carbsG * ratio, 1),
    fatG: round(basis.fatG * ratio, 1),
  };
}
