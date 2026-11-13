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
  [/cycl|bik|ride/i, "רכיבה"],
  [/run|jog/i, "ריצה"],
  [/walk/i, "הליכה"],
  [/hik/i, "הליכה"],
  [/swim/i, "שחייה"],
  [/crossfit|crosstraining|highintensity|hiit/i, "CrossFit"],
  [/strength|weightlift|weight|workout/i, "אימון כוח"],
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
  external_provider: "health_connect" | "strava";
  external_activity_id: string;
  /** The app that recorded the workout, as the source names it. */
  source_app: string | null;
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
    source_app: workout.sourceName,
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
  source_app?: string | null;
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

/**
 * Which copy of a workout counts when it arrived from several sources. Higher wins.
 *   3  Health Connect, recorded by a device app such as Samsung Health: the original measurement.
 *   2  Strava: the original when the workout was started in Strava, a copy when Samsung Health uploaded it.
 *   1  Health Connect record that Strava itself wrote: a copy of a Strava workout.
 *   0  Typed in by hand.
 * So a watch workout counts from Health Connect, a Strava-recorded workout counts from Strava,
 * and a manual entry never counts next to a measured one.
 */
export function sourceRank(row: { external_provider: string | null; source_app?: string | null }): number {
  if (row.external_provider === null) return 0;
  if (row.external_provider === "strava") return 2;
  if (row.external_provider === "health_connect") return /strava/i.test(row.source_app ?? "") ? 1 : 3;
  return 1;
}

export type PlannedInsert = SyncedActivityInsert & { excluded_from_balance: boolean };

export type SyncPlan = {
  /** Workouts that are not in the database yet. Copies of a workout that already counts arrive excluded. */
  toInsert: PlannedInsert[];
  /**
   * Activities already in the diary that are a lower-ranked copy of a newly arrived workout.
   * They stay in the diary but stop counting toward the balance.
   */
  excludeIds: string[];
  alreadySynced: number;
};

type Counted = {
  id: string | null;
  started_at: string;
  duration_seconds: number | null;
  rank: number;
  planned: PlannedInsert | null;
};

/**
 * Decides what to insert and what to stop counting. Only newly arrived workouts trigger a decision,
 * so a choice the user made by hand on existing activities is never overridden by a later sync.
 */
export function planNewActivities(candidates: SyncedActivityInsert[], existing: ExistingActivity[]): SyncPlan {
  const known = new Set(
    existing.filter((row) => row.external_provider !== null).map((row) => `${row.external_provider}:${row.external_activity_id}`),
  );
  let counted: Counted[] = existing
    .filter((row) => !row.excluded_from_balance)
    .map((row) => ({ id: row.id, started_at: row.started_at, duration_seconds: row.duration_seconds, rank: sourceRank(row), planned: null }));

  const toInsert: PlannedInsert[] = [];
  const excludeIds: string[] = [];
  let alreadySynced = 0;

  const ordered = [...candidates].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  for (const candidate of ordered) {
    const key = `${candidate.external_provider}:${candidate.external_activity_id}`;
    if (known.has(key)) {
      alreadySynced += 1;
      continue;
    }
    known.add(key);

    const rank = sourceRank(candidate);
    const same = counted.filter((other) => isSameWorkout(candidate, other));
    const planned: PlannedInsert = { ...candidate, excluded_from_balance: same.some((other) => other.rank >= rank) };
    toInsert.push(planned);
    if (planned.excluded_from_balance) continue;

    // The newcomer counts: every lower-ranked copy of the same workout stops counting.
    for (const other of same) {
      if (other.id !== null) excludeIds.push(other.id);
      if (other.planned) other.planned.excluded_from_balance = true;
    }
    counted = counted.filter((other) => !same.includes(other));
    counted.push({ id: null, started_at: candidate.started_at, duration_seconds: candidate.duration_seconds, rank, planned });
  }

  return { toInsert, excludeIds, alreadySynced };
}

export function planSync(workouts: HealthWorkout[], existing: ExistingActivity[]): SyncPlan {
  return planNewActivities(workouts.map(workoutToActivity), existing);
}

// ------------------------------------------------------------------ Strava

/** Checks one activity object from the Strava API (summary fields, plus calories from the detail call). */
export function stravaToActivity(raw: unknown): SyncedActivityInsert | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "number" || typeof record.id === "string" ? String(record.id) : "";
  const startDate = typeof record.start_date === "string" ? record.start_date : "";
  const start = new Date(startDate).getTime();
  if (id === "" || Number.isNaN(start)) return null;

  const sport = typeof record.sport_type === "string" ? record.sport_type : typeof record.type === "string" ? record.type : "other";
  const elapsed = finite(record.elapsed_time, 86_400 * 2);
  const moving = finite(record.moving_time, 86_400 * 2);
  const duration = elapsed !== null && elapsed > 0 ? elapsed : moving;
  const calories = finite(record.calories, 20_000);
  // Rides with a power meter report mechanical work in kilojoules, which is close to kilocalories burned.
  const kilojoules = finite(record.kilojoules, 20_000);
  const energy = calories !== null && calories > 0 ? calories : kilojoules !== null && kilojoules > 0 ? kilojoules : null;
  const distance = finite(record.distance, 1_000_000);
  const device = typeof record.device_name === "string" && record.device_name.trim() !== "" ? record.device_name.trim().slice(0, 60) : null;
  const name = typeof record.name === "string" && record.name.trim() !== "" ? record.name.trim().slice(0, 80) : null;

  return {
    external_provider: "strava",
    external_activity_id: id,
    source_app: device ?? "Strava",
    activity_type: activityTypeLabel(sport),
    started_at: new Date(start).toISOString(),
    duration_seconds: duration !== null && duration > 0 ? Math.round(duration) : null,
    distance_m: distance !== null && distance > 0 ? Math.round(distance * 10) / 10 : null,
    calories_active_kcal: null,
    calories_total_kcal: energy === null ? null : Math.round(energy * 10) / 10,
    calories_source: "external",
    notes: name ? `Strava: ${name}` : "סונכרן מ-Strava",
  };
}
