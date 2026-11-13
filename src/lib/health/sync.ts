// Turning workouts read from Health Connect into activity rows, and spotting duplicates. Pure code.
// A workout object comes from a native plugin and is treated as untrusted input.

export type HealthWorkout = {
  platformId: string;
  workoutType: string;
  startDate: string;
  endDate: string;
  durationSeconds: number | null;
  totalEnergyKcal: number | null;
  distanceM: number | null;
  sourceName: string | null;
};

const TYPE_LABELS: [RegExp, string][] = [
  [/cycl|bik/i, "רכיבה"],
  [/run|jog/i, "ריצה"],
  [/walk/i, "הליכה"],
  [/hik/i, "הליכה"],
  [/swim/i, "שחייה"],
  [/crossfit|crosstraining|highintensity|hiit/i, "CrossFit"],
  [/strength|weightlift|weight/i, "אימון כוח"],
  [/yoga/i, "יוגה"],
  [/pilates/i, "פילאטיס"],
];

/** Hebrew activity name for a Health Connect workout type. Unknown types keep their original name. */
export function activityTypeLabel(workoutType: string): string {
  for (const [pattern, label] of TYPE_LABELS) {
    if (pattern.test(workoutType)) return label;
  }
  const clean = workoutType.trim();
  return clean === "" || /^other$/i.test(clean) ? "אחר" : clean.slice(0, 40);
}

function finite(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

/** Checks one raw workout object. Null when it has no id or no valid start time. */
export function parseWorkout(raw: unknown): HealthWorkout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const text = (...keys: string[]): string => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return "";
  };
  const startDate = text("startDate", "startTime", "start");
  const endDate = text("endDate", "endTime", "end");
  const start = new Date(startDate).getTime();
  if (Number.isNaN(start)) return null;
  const workoutType = text("workoutType", "exerciseType", "type") || "other";
  // Without an id from the source, the start, end and type identify the workout well enough to avoid duplicates.
  const platformId = text("platformId", "id", "uuid") || `generated:${new Date(start).toISOString()}:${endDate}:${workoutType}`;

  const end = new Date(endDate).getTime();
  let duration = finite(record.duration, 86_400 * 2);
  if ((duration === null || duration === 0) && !Number.isNaN(end) && end > start) duration = (end - start) / 1000;

  const energy = finite(record.totalEnergyBurned ?? record.calories ?? record.energy, 20_000);
  const distance = finite(record.totalDistance ?? record.distance, 1_000_000);
  return {
    platformId: platformId.slice(0, 200),
    workoutType,
    startDate: new Date(start).toISOString(),
    endDate: Number.isNaN(end) ? new Date(start).toISOString() : new Date(end).toISOString(),
    durationSeconds: duration !== null && duration > 0 ? Math.round(duration) : null,
    totalEnergyKcal: energy !== null && energy > 0 ? Math.round(energy * 10) / 10 : null,
    distanceM: distance !== null && distance > 0 ? Math.round(distance * 10) / 10 : null,
    sourceName: text("sourceName", "sourceId").slice(0, 60) || null,
  };
}

export type SyncedActivityInsert = {
  external_provider: "health_connect";
  external_activity_id: string;
  activity_type: string;
  started_at: string;
  duration_seconds: number | null;
  distance_m: number | null;
  calories_active_kcal: null;
  calories_total_kcal: number | null;
  calories_source: "external";
  notes: string | null;
};

/**
 * The activity row for a synced workout. The energy figure is stored as total calories:
 * the balance then removes the resting share of the workout's duration, so nothing is counted twice.
 */
export function workoutToActivity(workout: HealthWorkout): SyncedActivityInsert {
  return {
    external_provider: "health_connect",
    external_activity_id: workout.platformId,
    activity_type: activityTypeLabel(workout.workoutType),
    started_at: workout.startDate,
    duration_seconds: workout.durationSeconds,
    distance_m: workout.distanceM,
    calories_active_kcal: null,
    calories_total_kcal: workout.totalEnergyKcal,
    calories_source: "external",
    notes: workout.sourceName ? `סונכרן מ-${workout.sourceName}` : "סונכרן מ-Health Connect",
  };
}

export type ExistingActivity = {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  external_provider: string | null;
  external_activity_id: string | null;
  excluded_from_balance: boolean;
};

/** Minutes two workouts' start times may differ and still be the same workout when no duration is known. */
const START_TOLERANCE_MS = 20 * 60 * 1000;

function interval(startedAt: string, durationSeconds: number | null): [number, number] {
  const start = new Date(startedAt).getTime();
  return [start, start + Math.max(0, Number(durationSeconds ?? 0)) * 1000];
}

/** True when two workouts overlap for at least half of the shorter one, or start within 20 minutes of each other. */
export function isSameWorkout(
  a: { started_at: string; duration_seconds: number | null },
  b: { started_at: string; duration_seconds: number | null },
): boolean {
  const [aStart, aEnd] = interval(a.started_at, a.duration_seconds);
  const [bStart, bEnd] = interval(b.started_at, b.duration_seconds);
  if (Number.isNaN(aStart) || Number.isNaN(bStart)) return false;
  if (Math.abs(aStart - bStart) <= START_TOLERANCE_MS) return true;
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  return shorter > 0 && overlap >= shorter / 2;
}

export type SyncPlan = {
  /** Workouts that are not in the database yet. */
  toInsert: SyncedActivityInsert[];
  /**
   * Manually typed activities that are the same workout as a synced one. They stay in the diary
   * but stop counting toward the balance, so the workout is counted once, from the measured source.
   */
  manualDuplicateIds: string[];
  alreadySynced: number;
};

export function planSync(workouts: HealthWorkout[], existing: ExistingActivity[]): SyncPlan {
  const known = new Set(
    existing.filter((row) => row.external_provider === "health_connect").map((row) => row.external_activity_id),
  );
  const manual = existing.filter((row) => row.external_provider === null && !row.excluded_from_balance);

  const toInsert: SyncedActivityInsert[] = [];
  const seen = new Set<string>();
  let alreadySynced = 0;
  for (const workout of workouts) {
    if (known.has(workout.platformId)) {
      alreadySynced += 1;
      continue;
    }
    if (seen.has(workout.platformId)) continue;
    seen.add(workout.platformId);
    toInsert.push(workoutToActivity(workout));
  }

  // A manual entry is a duplicate when it matches any synced workout, new or already stored.
  const synced = [
    ...toInsert.map((row) => ({ started_at: row.started_at, duration_seconds: row.duration_seconds })),
    ...existing.filter((row) => row.external_provider === "health_connect" && !row.excluded_from_balance),
  ];
  const manualDuplicateIds = manual.filter((row) => synced.some((other) => isSameWorkout(row, other))).map((row) => row.id);

  return { toInsert, manualDuplicateIds, alreadySynced };
}
