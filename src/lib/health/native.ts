// Bridge to Health Connect through the Capacitor health plugin. Browser-side only.
// Everything here is a no-op outside the Android app.

import { parseWorkout, sessionEnergy, type HealthWorkout, type SessionEnergy } from "@/lib/health/sync";

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
  readSamples(options: {
    dataType: string;
    startDate: string;
    endDate: string;
    limit: number;
  }): Promise<{ samples?: unknown[] }>;
  openHealthConnectSettings(): Promise<void>;
};

const WORKOUTS = "workouts";
const TOTAL_CALORIES = "totalCalories";
const ACTIVE_CALORIES = "calories";
/** Asked for together with workouts so sessions carry energy and distance. */
const EXTRA_READ_TYPES = [ACTIVE_CALORIES, TOTAL_CALORIES, "distance"];

type Bridge = { isNativePlatform?: () => boolean; getPlatform?: () => string };

function bridge(): Bridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: Bridge }).Capacitor;
}

/** True inside the installed app (Android or iPhone), false in a normal browser. */
export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

export type HealthPlatform = "android" | "ios";

/** Which health store the app talks to: Health Connect on Android, Apple Health on an iPhone. */
export function healthPlatform(): HealthPlatform | null {
  if (!isNativeApp()) return null;
  return bridge()?.getPlatform?.() === "ios" ? "ios" : "android";
}

// Apple Health never tells an app whether read access was granted, so the app remembers that it asked.
const IOS_ASKED_KEY = "apple-health:asked";

function iosAsked(): boolean {
  try {
    return window.localStorage.getItem(IOS_ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberIosAsked() {
  try {
    window.localStorage.setItem(IOS_ASKED_KEY, "1");
  } catch {
    // Without storage the question is simply asked again next time.
  }
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
  if (healthPlatform() === "ios") return iosAsked() ? { state: "ready" } : { state: "needs_permission" };
  const status = await withTimeout(health.checkAuthorization({ read: [WORKOUTS] }), STATUS_TIMEOUT_MS);
  return status.readAuthorized?.includes(WORKOUTS) ? { state: "ready" } : { state: "needs_permission" };
}

/** Opens the permission sheet of the health store. Returns whether workouts can now be read. */
export async function requestHealthAccess(): Promise<boolean> {
  const { health } = await plugin();
  if (healthPlatform() === "ios") {
    await health.requestAuthorization({ read: [WORKOUTS, ACTIVE_CALORIES, "distance"] });
    rememberIosAsked();
    return true; // Apple Health does not report the answer; a sync that returns nothing shows it.
  }
  let status: { readAuthorized?: string[] };
  try {
    status = await health.requestAuthorization({ read: [WORKOUTS, ...EXTRA_READ_TYPES] });
  } catch {
    // Some plugin versions reject a data type they do not know; workouts alone is enough to sync.
    status = await health.requestAuthorization({ read: [WORKOUTS] });
  }
  return status.readAuthorized?.includes(WORKOUTS) === true;
}

/** Whether calorie records can be read. Without it a workout's energy cannot be read reliably. */
export async function canReadCalories(): Promise<boolean> {
  if (healthPlatform() === "ios") return true;
  const { health } = await plugin();
  const status = await withTimeout(health.checkAuthorization({ read: [TOTAL_CALORIES] }), STATUS_TIMEOUT_MS);
  return status.readAuthorized?.includes(TOTAL_CALORIES) === true;
}

const ENERGY_WINDOW_SLACK_MS = 120_000;

/**
 * Calorie records of one workout. Samsung Health writes a workout's energy as a total-calories
 * record for the session, which the plugin's own workout figure can miss, so it is read directly.
 */
export async function readSessionEnergy(workout: HealthWorkout): Promise<SessionEnergy> {
  // On an iPhone the workout already carries its active energy, as recorded by the watch.
  if (healthPlatform() === "ios") return { totalKcal: null, activeKcal: workout.totalEnergyKcal };
  const { health } = await plugin();
  const window = {
    startDate: new Date(new Date(workout.startDate).getTime() - ENERGY_WINDOW_SLACK_MS).toISOString(),
    endDate: new Date(new Date(workout.endDate).getTime() + ENERGY_WINDOW_SLACK_MS).toISOString(),
    limit: 500,
  };
  const read = async (dataType: string): Promise<number | null> => {
    try {
      const result = await withTimeout(health.readSamples({ dataType, ...window }), READ_TIMEOUT_MS);
      return sessionEnergy(result.samples ?? [], workout);
    } catch {
      return null; // permission missing or no data: the caller falls back
    }
  };
  const totalKcal = await read(TOTAL_CALORIES);
  if (totalKcal !== null) return { totalKcal, activeKcal: null };
  return { totalKcal: null, activeKcal: await read(ACTIVE_CALORIES) };
}

export async function openHealthSettings(): Promise<void> {
  if (healthPlatform() === "ios") return; // there is no settings screen to open; access is managed in the Health app
  const { health } = await plugin();
  await health.openHealthConnectSettings();
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export type WorkoutRead = {
  workouts: HealthWorkout[];
  /** How many records Health Connect returned, before unusable ones were skipped. */
  rawCount: number;
  /** Field names of the first record: shown when records arrive but none is usable. */
  sampleFields: string[];
};

/** Workouts recorded since the given time, oldest first. Unusable records are skipped. */
export async function readWorkouts(since: Date): Promise<WorkoutRead> {
  const { health } = await plugin();
  const workouts: HealthWorkout[] = [];
  let rawCount = 0;
  let sampleFields: string[] = [];
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
      rawCount += 1;
      if (sampleFields.length === 0 && typeof raw === "object" && raw !== null) sampleFields = Object.keys(raw).slice(0, 20);
      const workout = parseWorkout(raw);
      if (workout) workouts.push(workout);
    }
    if (!result.anchor || (result.workouts ?? []).length < PAGE_SIZE) break;
    anchor = result.anchor;
  }
  return { workouts, rawCount, sampleFields };
}
