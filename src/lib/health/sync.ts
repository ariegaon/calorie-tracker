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
  /** Device label when the record has one, otherwise the package name of the app that wrote it. */
  sourceName: string | null;
  /** Package name of the app that wrote the record, such as com.sec.android.app.shealth. */
  sourceId: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  "com.sec.android.app.shealth": "Samsung Health",
  "com.strava": "Strava",
  "com.google.android.apps.fitness": "Google Fit",
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
};

/** Readable name of the app that wrote a record. */
export function sourceLabel(workout: { sourceId: string | null; sourceName: string | null }): string {
  if (workout.sourceId && SOURCE_LABELS[workout.sourceId]) return SOURCE_LABELS[workout.sourceId];
  return workout.sourceId ?? workout.sourceName ?? "Health Connect";
}

/** Shorter than this, a recorded distance is noise (a gym session is not a 28-metre walk). */
const MIN_DISTANCE_M = 50;

/**
 * Below this many kcal per minute a workout's energy figure is not believable:
 * it is less than the body burns at rest, so it is some unrelated stray record.
 */
export const MIN_PLAUSIBLE_KCAL_PER_MINUTE = 1;

export function isPlausibleEnergy(kcal: number | null, durationSeconds: number | null): boolean {
  if (kcal === null || kcal <= 0) return false;
  if (durationSeconds === null || durationSeconds <= 0) return true;
  return kcal >= (durationSeconds / 60) * MIN_PLAUSIBLE_KCAL_PER_MINUTE;
}

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
    distanceM: distance !== null && distance >= MIN_DISTANCE_M ? Math.round(distance * 10) / 10 : null,
    sourceName: text("sourceName").slice(0, 60) || null,
    sourceId: text("sourceId").slice(0, 100) || null,
  };
}

// ------------------------------------------------------------------ energy of a session

/** Seconds a calorie record may start before or end after the session and still belong to it. */
const ENERGY_WINDOW_SLACK_MS = 120_000;

/**
 * Energy of one workout from calorie records read for its time window.
 * Only records that lie inside the session are used. When several apps wrote records for the
 * same window, the app that recorded the workout wins; otherwise the app with the largest sum.
 * Sums are never added across apps, because each app's records describe the same workout.
 */
export function sessionEnergy(samples: unknown[], workout: HealthWorkout): number | null {
  const start = new Date(workout.startDate).getTime() - ENERGY_WINDOW_SLACK_MS;
  const end = new Date(workout.endDate).getTime() + ENERGY_WINDOW_SLACK_MS;
  const bySource = new Map<string, number>();
  for (const raw of samples) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const value = finite(record.value, 20_000);
    const sampleStart = new Date(typeof record.startDate === "string" ? record.startDate : "").getTime();
    const sampleEnd = new Date(typeof record.endDate === "string" ? record.endDate : "").getTime();
    if (value === null || value <= 0 || Number.isNaN(sampleStart) || Number.isNaN(sampleEnd)) continue;
    if (sampleStart < start || sampleEnd > end) continue;
    const source = typeof record.sourceId === "string" && record.sourceId !== "" ? record.sourceId : "unknown";
    bySource.set(source, (bySource.get(source) ?? 0) + value);
  }
  if (bySource.size === 0) return null;
  const own = workout.sourceId ? bySource.get(workout.sourceId) : undefined;
  const sum = own ?? Math.max(...bySource.values());
  return Math.round(sum * 10) / 10;
}

export type SessionEnergy = {
  /** From TotalCaloriesBurned records of the session. */
  totalKcal: number | null;
  /** From ActiveCaloriesBurned records of the session, used when there are no total records. */
  activeKcal: number | null;
};

export type SyncedActivityInsert = {
  external_provider: "health_connect" | "strava";
  external_activity_id: string;
  /** The app that recorded the workout, as the source names it. */
  source_app: string | null;
  activity_type: string;
  started_at: string;
  duration_seconds: number | null;
  distance_m: number | null;
  calories_active_kcal: number | null;
  calories_total_kcal: number | null;
  calories_source: "external";
  notes: string | null;
};

export type WorkoutOptions = {
  /**
   * Name to use for workouts that Health Connect only knows as a generic "workout".
   * Samsung Health reports CrossFit this way, so the user chooses what such workouts are.
   */
  genericLabel?: string | null;
  /** Calorie records read for this session. They are more reliable than the figure on the workout itself. */
  energy?: SessionEnergy | null;
};

export const GENERIC_ACTIVITY_LABEL = "אחר";

/**
 * The activity row for a synced workout.
 * Energy, in order of preference:
 *   1. total calories recorded for the session: stored as total, and the balance removes the resting share;
 *   2. active calories recorded for the session: stored as active and counted as they are;
 *   3. the figure attached to the workout, stored as total, but only when it is believable.
 */
export function workoutToActivity(workout: HealthWorkout, options: WorkoutOptions = {}): SyncedActivityInsert {
  let label = activityTypeLabel(workout.workoutType);
  if (label === GENERIC_ACTIVITY_LABEL && options.genericLabel) label = options.genericLabel.trim().slice(0, 40) || label;

  let total: number | null = null;
  let active: number | null = null;
  if (options.energy?.totalKcal != null && options.energy.totalKcal > 0) total = options.energy.totalKcal;
  else if (options.energy?.activeKcal != null && options.energy.activeKcal > 0) active = options.energy.activeKcal;
  else if (isPlausibleEnergy(workout.totalEnergyKcal, workout.durationSeconds)) total = workout.totalEnergyKcal;

  return {
    external_provider: "health_connect",
    external_activity_id: workout.platformId,
    source_app: workout.sourceId ?? workout.sourceName,
    activity_type: label,
    started_at: workout.startDate,
    duration_seconds: workout.durationSeconds,
    distance_m: workout.distanceM,
    calories_active_kcal: active,
    calories_total_kcal: total,
    calories_source: "external",
    notes: `סונכרן מ-${sourceLabel(workout)}`,
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
  return planNewActivities(workouts.map((workout) => workoutToActivity(workout)), existing);
}

// ------------------------------------------------------------------ repairing rows from earlier syncs

export type StoredSyncedActivity = {
  id: string;
  external_activity_id: string | null;
  activity_type: string;
  duration_seconds: number | null;
  distance_m: number | null;
  calories_active_kcal: number | null;
  calories_total_kcal: number | null;
  source_app: string | null;
};

/** True when a stored row has no believable energy figure and nothing typed in by the user. */
export function needsEnergy(row: Pick<StoredSyncedActivity, "calories_active_kcal" | "calories_total_kcal" | "duration_seconds">): boolean {
  if (row.calories_active_kcal !== null) return false;
  const total = row.calories_total_kcal === null ? null : Number(row.calories_total_kcal);
  return !isPlausibleEnergy(total, row.duration_seconds === null ? null : Number(row.duration_seconds));
}

/**
 * What to change on a row stored by an earlier sync, given what the workout looks like now.
 * Only gaps are filled: a missing or unbelievable energy figure, a generic type, a stray short
 * distance and the source app. Values the user typed (active calories, a specific type) are kept.
 */
export function repairFor(stored: StoredSyncedActivity, fresh: SyncedActivityInsert): Record<string, unknown> | null {
  const changes: Record<string, unknown> = {};
  if (needsEnergy(stored)) {
    if (fresh.calories_total_kcal !== null) changes.calories_total_kcal = fresh.calories_total_kcal;
    else if (fresh.calories_active_kcal !== null) {
      changes.calories_active_kcal = fresh.calories_active_kcal;
      changes.calories_total_kcal = null;
    } else if (stored.calories_total_kcal !== null) changes.calories_total_kcal = null;
  }
  if (stored.activity_type === GENERIC_ACTIVITY_LABEL && fresh.activity_type !== GENERIC_ACTIVITY_LABEL) {
    changes.activity_type = fresh.activity_type;
  }
  if (stored.distance_m !== null && Number(stored.distance_m) < MIN_DISTANCE_M && fresh.distance_m === null) {
    changes.distance_m = null;
  }
  if (fresh.source_app !== null && stored.source_app !== fresh.source_app) changes.source_app = fresh.source_app;
  return Object.keys(changes).length > 0 ? changes : null;
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
