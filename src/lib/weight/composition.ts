// The second signal beside the scale: waist circumference, or body-fat percentage when no waist is
// measured. Pure code. A tape measure is a better guide to fat change than a scale alone, but a single
// measurement can be off by about a centimetre, so only a fitted change of 1 cm (or 1 percentage point)
// across at least three weeks counts.

export const COMPOSITION_WINDOW_DAYS = 42;
export const MIN_MEASUREMENTS = 3;
export const MIN_SPAN_DAYS = 21;
export const MIN_WAIST_CHANGE_CM = 1;
export const MIN_BODY_FAT_CHANGE_POINTS = 1;

export type MeasurementPoint = { day: number; waistCm: number | null; bodyFatPercent: number | null };

export type SeriesTrend = {
  /** Change along the fitted line from the first to the last measurement in the window. */
  change: number;
  perWeek: number;
  latest: number;
  count: number;
  spanDays: number;
};

export type CompositionSignal = {
  /** fat_loss_likely: waist (or body fat) clearly down. gaining: clearly up. */
  verdict: "fat_loss_likely" | "stable" | "gaining" | "not_enough_data";
  source: "waist" | "body_fat" | null;
  waist: SeriesTrend | null;
  bodyFat: SeriesTrend | null;
};

function seriesTrend(points: { day: number; value: number }[]): SeriesTrend | null {
  if (points.length < MIN_MEASUREMENTS) return null;
  const span = points[points.length - 1].day - points[0].day;
  if (span < MIN_SPAN_DAYS) return null;
  const mx = points.reduce((sum, point) => sum + point.day, 0) / points.length;
  const my = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  for (const point of points) {
    sxx += (point.day - mx) ** 2;
    sxy += (point.day - mx) * (point.value - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return {
    change: slope * span,
    perWeek: slope * 7,
    latest: points[points.length - 1].value,
    count: points.length,
    spanDays: span,
  };
}

function verdictOf(trend: SeriesTrend, threshold: number): CompositionSignal["verdict"] {
  if (trend.change <= -threshold) return "fat_loss_likely";
  if (trend.change >= threshold) return "gaining";
  return "stable";
}

export function compositionSignal(points: MeasurementPoint[], endDay: number): CompositionSignal {
  const inWindow = points
    .filter((point) => point.day <= endDay && point.day > endDay - COMPOSITION_WINDOW_DAYS)
    .sort((a, b) => a.day - b.day);
  const waist = seriesTrend(
    inWindow.filter((point) => point.waistCm !== null).map((point) => ({ day: point.day, value: Number(point.waistCm) })),
  );
  const bodyFat = seriesTrend(
    inWindow
      .filter((point) => point.bodyFatPercent !== null)
      .map((point) => ({ day: point.day, value: Number(point.bodyFatPercent) })),
  );
  if (waist) return { verdict: verdictOf(waist, MIN_WAIST_CHANGE_CM), source: "waist", waist, bodyFat };
  if (bodyFat) return { verdict: verdictOf(bodyFat, MIN_BODY_FAT_CHANGE_POINTS), source: "body_fat", waist, bodyFat };
  return { verdict: "not_enough_data", source: null, waist, bodyFat };
}

/** One line in Hebrew for a trend, e.g. "ירידה של 1.5 ס"מ ב-4 שבועות". */
export function describeChange(trend: SeriesTrend, unit: string): string {
  const weeks = Math.max(1, Math.round(trend.spanDays / 7));
  const amount = Math.abs(trend.change).toFixed(1);
  if (Math.abs(trend.change) < 0.3) return `יציב ב-${weeks} שבועות`;
  return `${trend.change < 0 ? "ירידה" : "עלייה"} של ${amount} ${unit} ב-${weeks} שבועות`;
}
