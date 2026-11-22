// How much data the insights have to work with. Pure functions.

/** Logged days needed before any insight is shown: fewer than this is too little to tell a pattern from chance. */
export const MIN_LOGGED_DAYS = 14;
/** Weigh-ins needed for the weight-based insights. */
export const MIN_WEIGH_INS = 6;
/** The window the insights look at. */
export const INSIGHT_WINDOW_DAYS = 60;

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Distinct local days among the given timestamps (ISO strings). */
export function countDistinctDays(timestamps: string[]): number {
  const days = new Set<string>();
  for (const iso of timestamps) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) days.add(localDay(date));
  }
  return days.size;
}

export type Readiness = {
  loggedDays: number;
  weighIns: number;
  ready: boolean;
  /** Logged days still missing before the first insights; 0 when ready. */
  daysToGo: number;
};

export function insightReadiness(foodTimestamps: string[], weighInTimestamps: string[]): Readiness {
  const loggedDays = countDistinctDays(foodTimestamps);
  const weighIns = countDistinctDays(weighInTimestamps);
  const daysToGo = Math.max(0, MIN_LOGGED_DAYS - loggedDays);
  return { loggedDays, weighIns, ready: daysToGo === 0, daysToGo };
}
