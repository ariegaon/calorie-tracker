// Bridge to Health Connect through the Capacitor health plugin. Browser-side only.
// Everything here is a no-op outside the Android app.

import { parseWorkout, type HealthWorkout } from "@/lib/health/sync";

/** The parts of the plugin this app uses, typed loosely so plugin updates cannot break the build. */
type HealthPlugin = {
  isAvailable(): Promise<{ available?: boolean; reason?: string }>;
  requestAuthorization(options: { read: string[]; write?: string[] }): Promise<{ readAuthorized?: string[] }>;
  checkAuthorization(options: { read: string[]; write?: string[] }): Promise<{ readAuthorized?: string[] }>;
  queryWorkouts(options: {
    startDate: string;
    endDate: string;
    limit: number;
    ascending: boolean;
    anchor?: string;
  }): Promise<{ workouts?: unknown[]; anchor?: string | null }>;
  openHealthConnectSettings(): Promise<void>;
};

const WORKOUTS = "workouts";
/** Asked for together with workouts so sessions carry energy and distance. */
const EXTRA_READ_TYPES = ["calories", "totalCalories", "distance"];

/** True inside the Android app, false in a normal browser. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return bridge?.isNativePlatform?.() === true;
}

/**
 * Loads the plugin. It is returned inside an object on purpose: a Capacitor plugin is a proxy that
 * answers every property, including "then", so returning it directly from an async function makes
 * the promise wait forever on a native method that does not exist.
 */
async function plugin(): Promise<{ health: HealthPlugin }> {
  const loaded = await import("@capgo/capacitor-health");
  return { health: loaded.Health as unknown as HealthPlugin };
}

/** Rejects when a native call does not answer in time, so the screen never waits forever. */
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("health plugin timeout")), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const STATUS_TIMEOUT_MS = 12_000;
const READ_TIMEOUT_MS = 30_000;

export type HealthStatus =
  | { state: "unavailable"; reason: string | null }
  | { state: "needs_permission" }
  | { state: "ready" };

export async function healthStatus(): Promise<HealthStatus> {
  if (!isNativeApp()) return { state: "unavailable", reason: null };
  const { health } = await plugin();
  const availability = await withTimeout(health.isAvailable(), STATUS_TIMEOUT_MS);
  if (!availability.available) return { state: "unavailable", reason: availability.reason ?? null };
  const status = await withTimeout(health.checkAuthorization({ read: [WORKOUTS] }), STATUS_TIMEOUT_MS);
  return status.readAuthorized?.includes(WORKOUTS) ? { state: "ready" } : { state: "needs_permission" };
}

/** Opens the Health Connect permission sheet. Returns whether workouts can now be read. */
export async function requestHealthAccess(): Promise<boolean> {
  const { health } = await plugin();
  let status: { readAuthorized?: string[] };
  try {
    status = await health.requestAuthorization({ read: [WORKOUTS, ...EXTRA_READ_TYPES] });
  } catch {
    // Some plugin versions reject a data type they do not know; workouts alone is enough to sync.
    status = await health.requestAuthorization({ read: [WORKOUTS] });
  }
  return status.readAuthorized?.includes(WORKOUTS) === true;
}

export async function openHealthSettings(): Promise<void> {
  const { health } = await plugin();
  await health.openHealthConnectSettings();
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

/** Workouts recorded since the given time, oldest first. Unusable records are skipped. */
export async function readWorkouts(since: Date): Promise<HealthWorkout[]> {
  const { health } = await plugin();
  const workouts: HealthWorkout[] = [];
  let anchor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await withTimeout(
      health.queryWorkouts({
        startDate: since.toISOString(),
        endDate: new Date().toISOString(),
        limit: PAGE_SIZE,
        ascending: true,
        ...(anchor ? { anchor } : {}),
      }),
      READ_TIMEOUT_MS,
    );
    for (const raw of result.workouts ?? []) {
      const workout = parseWorkout(raw);
      if (workout) workouts.push(workout);
    }
    if (!result.anchor || (result.workouts ?? []).length < PAGE_SIZE) break;
    anchor = result.anchor;
  }
  return workouts;
}
