import type { Json } from "./oura-client.js";

export interface DayRow {
  day: string;
  readiness_score: number | null;
  sleep_score: number | null;
  activity_score: number | null;
  total_sleep_h: number | null;
  time_in_bed_h: number | null;
  deep_min: number | null;
  rem_min: number | null;
  light_min: number | null;
  awake_min: number | null;
  sleep_efficiency: number | null;
  sleep_latency_min: number | null;
  bedtime_start: string | null;
  bedtime_end: string | null;
  avg_hrv_ms: number | null;
  lowest_hr_bpm: number | null;
  avg_hr_bpm: number | null;
  avg_breath: number | null;
  temperature_deviation: number | null;
  hrv_balance: number | null;
  recovery_index: number | null;
  steps: number | null;
  active_calories: number | null;
  total_calories: number | null;
  high_activity_min: number | null;
  medium_activity_min: number | null;
  low_activity_min: number | null;
  workouts: number;
  workout_min: number;
  workout_calories: number;
  workout_types: string[];
  stress_high_min: number | null;
  recovery_high_min: number | null;
  stress_summary: string | null;
  spo2_avg: number | null;
  resilience_level: string | null;
}

export interface DashboardInput {
  range: { start_date: string; end_date: string };
  readiness: Json[];
  dailySleep: Json[];
  sleepPeriods: Json[];
  activity: Json[];
  workouts: Json[];
  stress: Json[];
  spo2: Json[];
  resilience: Json[];
}

export interface DashboardSummary {
  range: { start_date: string; end_date: string; days_with_data: number };
  averages: Record<string, number | null>;
  latest: DayRow | null;
  hrv: { mean_ms: number | null; latest_ms: number | null; latest_vs_mean_pct: number | null };
  resting_hr: { mean_bpm: number | null; latest_bpm: number | null; latest_vs_mean_bpm: number | null };
  training_load: {
    workouts: number;
    total_minutes: number;
    total_calories: number;
    minutes_by_intensity: Record<string, number>;
    minutes_by_type: Record<string, number>;
    /** Sum of (minutes x intensity weight easy=1, moderate=2, hard=3), a simple session-RPE-style load. */
    load_points: number;
    avg_daily_load_points: number;
  };
  rows: DayRow[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const round = (v: number | null, digits = 1): number | null =>
  v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits;
const secToMin = (v: unknown): number | null => (num(v) === null ? null : Math.round((num(v) as number) / 60));
const secToH = (v: unknown): number | null => (num(v) === null ? null : round((num(v) as number) / 3600, 2));

function byDay<T extends Json>(records: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of records) if (typeof r.day === "string") m.set(r.day, r);
  return m;
}

function groupByDay<T extends Json>(records: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of records) {
    if (typeof r.day !== "string") continue;
    const arr = m.get(r.day) ?? [];
    arr.push(r);
    m.set(r.day, arr);
  }
  return m;
}

/** The main sleep period of a day: `long_sleep` if present, else the longest one. */
export function pickMainSleep(periods: Json[]): Json | undefined {
  const long = periods.filter((p) => p.type === "long_sleep");
  const pool = long.length ? long : periods;
  return pool.sort((a, b) => (num(b.total_sleep_duration) ?? 0) - (num(a.total_sleep_duration) ?? 0))[0];
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const INTENSITY_WEIGHT: Record<string, number> = { easy: 1, moderate: 2, hard: 3 };

function workoutMinutes(w: Json): number {
  const s = Date.parse(String(w.start_datetime ?? ""));
  const e = Date.parse(String(w.end_datetime ?? ""));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.round((e - s) / 60_000);
}

export function buildDashboard(input: DashboardInput): DashboardSummary {
  const readiness = byDay(input.readiness);
  const dailySleep = byDay(input.dailySleep);
  const activity = byDay(input.activity);
  const stress = byDay(input.stress);
  const spo2 = byDay(input.spo2);
  const resilience = byDay(input.resilience);
  const sleepPeriods = groupByDay(input.sleepPeriods);
  const workouts = groupByDay(input.workouts);

  // One row per calendar day in the window, so missing days show up as gaps instead of vanishing.
  const days: string[] = [];
  for (let d = input.range.start_date; d <= input.range.end_date; d = nextDay(d)) days.push(d);
  const hasData = (day: string) =>
    readiness.has(day) || dailySleep.has(day) || activity.has(day) || sleepPeriods.has(day) || workouts.has(day) || stress.has(day);
  const rows: DayRow[] = days.map((day) => {
      const r = readiness.get(day);
      const ds = dailySleep.get(day);
      const sp = pickMainSleep(sleepPeriods.get(day) ?? []);
      const a = activity.get(day);
      const ws = workouts.get(day) ?? [];
      const st = stress.get(day);
      const sp2 = spo2.get(day);
      const rc = (r?.contributors ?? {}) as Json;
      const spo2Obj = (sp2?.spo2_percentage ?? {}) as Json;
      return {
        day,
        readiness_score: num(r?.score),
        sleep_score: num(ds?.score),
        activity_score: num(a?.score),
        total_sleep_h: secToH(sp?.total_sleep_duration),
        time_in_bed_h: secToH(sp?.time_in_bed),
        deep_min: secToMin(sp?.deep_sleep_duration),
        rem_min: secToMin(sp?.rem_sleep_duration),
        light_min: secToMin(sp?.light_sleep_duration),
        awake_min: secToMin(sp?.awake_time),
        sleep_efficiency: num(sp?.efficiency),
        sleep_latency_min: secToMin(sp?.latency),
        bedtime_start: str(sp?.bedtime_start),
        bedtime_end: str(sp?.bedtime_end),
        avg_hrv_ms: num(sp?.average_hrv),
        lowest_hr_bpm: num(sp?.lowest_heart_rate),
        avg_hr_bpm: num(sp?.average_heart_rate),
        avg_breath: num(sp?.average_breath),
        temperature_deviation: num(r?.temperature_deviation),
        hrv_balance: num(rc.hrv_balance),
        recovery_index: num(rc.recovery_index),
        steps: num(a?.steps),
        active_calories: num(a?.active_calories),
        total_calories: num(a?.total_calories),
        high_activity_min: secToMin(a?.high_activity_time),
        medium_activity_min: secToMin(a?.medium_activity_time),
        low_activity_min: secToMin(a?.low_activity_time),
        workouts: ws.length,
        workout_min: ws.reduce((s, w) => s + workoutMinutes(w), 0),
        workout_calories: ws.reduce((s, w) => s + (num(w.calories) ?? 0), 0),
        workout_types: [...new Set(ws.map((w) => String(w.activity ?? "unknown")))],
        stress_high_min: secToMin(st?.stress_high),
        recovery_high_min: secToMin(st?.recovery_high),
        stress_summary: str(st?.day_summary),
        spo2_avg: num(spo2Obj.average),
        resilience_level: str(resilience.get(day)?.level),
      };
    });

  const mean = (key: keyof DayRow): number | null => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
    return vals.length ? round(vals.reduce((s, v) => s + v, 0) / vals.length, 1) : null;
  };
  const averages: Record<string, number | null> = {
    readiness_score: mean("readiness_score"),
    sleep_score: mean("sleep_score"),
    activity_score: mean("activity_score"),
    total_sleep_h: mean("total_sleep_h"),
    sleep_efficiency: mean("sleep_efficiency"),
    avg_hrv_ms: mean("avg_hrv_ms"),
    lowest_hr_bpm: mean("lowest_hr_bpm"),
    steps: mean("steps"),
    active_calories: mean("active_calories"),
    stress_high_min: mean("stress_high_min"),
    recovery_high_min: mean("recovery_high_min"),
    spo2_avg: mean("spo2_avg"),
  };

  const latest = [...rows].reverse().find((r) => hasData(r.day)) ?? null;
  const hrvMean = averages.avg_hrv_ms;
  const hrvLatest = latest?.avg_hrv_ms ?? null;
  const rhrMean = averages.lowest_hr_bpm;
  const rhrLatest = latest?.lowest_hr_bpm ?? null;

  const minutesByIntensity: Record<string, number> = {};
  const minutesByType: Record<string, number> = {};
  let loadPoints = 0;
  let totalMin = 0;
  let totalCal = 0;
  for (const w of input.workouts) {
    const min = workoutMinutes(w);
    const intensity = String(w.intensity ?? "unknown");
    const type = String(w.activity ?? "unknown");
    minutesByIntensity[intensity] = (minutesByIntensity[intensity] ?? 0) + min;
    minutesByType[type] = (minutesByType[type] ?? 0) + min;
    loadPoints += min * (INTENSITY_WEIGHT[intensity] ?? 1.5);
    totalMin += min;
    totalCal += num(w.calories) ?? 0;
  }
  const rangeDays =
    Math.round((Date.parse(input.range.end_date) - Date.parse(input.range.start_date)) / 86_400_000) + 1;

  return {
    range: { ...input.range, days_with_data: days.filter(hasData).length },
    averages,
    latest,
    hrv: {
      mean_ms: hrvMean,
      latest_ms: hrvLatest,
      latest_vs_mean_pct: hrvMean && hrvLatest !== null ? round(((hrvLatest - hrvMean) / hrvMean) * 100, 1) : null,
    },
    resting_hr: {
      mean_bpm: rhrMean,
      latest_bpm: rhrLatest,
      latest_vs_mean_bpm: rhrMean !== null && rhrLatest !== null ? round(rhrLatest - rhrMean, 1) : null,
    },
    training_load: {
      workouts: input.workouts.length,
      total_minutes: totalMin,
      total_calories: Math.round(totalCal),
      minutes_by_intensity: minutesByIntensity,
      minutes_by_type: minutesByType,
      load_points: Math.round(loadPoints),
      avg_daily_load_points: round(loadPoints / Math.max(1, rangeDays), 1) ?? 0,
    },
    rows,
  };
}

/** Compact markdown table with the columns most people put on a dashboard. */
export function dashboardMarkdown(s: DashboardSummary): string {
  const cols: Array<[string, (r: DayRow) => string]> = [
    ["day", (r) => r.day],
    ["ready", (r) => fmt(r.readiness_score)],
    ["sleep", (r) => fmt(r.sleep_score)],
    ["act", (r) => fmt(r.activity_score)],
    ["sleep h", (r) => fmt(r.total_sleep_h)],
    ["eff %", (r) => fmt(r.sleep_efficiency)],
    ["HRV ms", (r) => fmt(r.avg_hrv_ms)],
    ["RHR", (r) => fmt(r.lowest_hr_bpm)],
    ["temp Δ", (r) => fmt(r.temperature_deviation)],
    ["steps", (r) => fmt(r.steps)],
    ["workout min", (r) => String(r.workout_min)],
    ["stress min", (r) => fmt(r.stress_high_min)],
  ];
  const header = `| ${cols.map(([h]) => h).join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = s.rows.map((r) => `| ${cols.map(([, f]) => f(r)).join(" | ")} |`).join("\n");
  const avg = `Averages ${s.range.start_date}…${s.range.end_date}: readiness ${fmt(s.averages.readiness_score)}, sleep ${fmt(
    s.averages.sleep_score,
  )}, HRV ${fmt(s.averages.avg_hrv_ms)} ms, RHR ${fmt(s.averages.lowest_hr_bpm)} bpm, sleep ${fmt(
    s.averages.total_sleep_h,
  )} h.`;
  const load = `Training load: ${s.training_load.workouts} workouts, ${s.training_load.total_minutes} min, ${s.training_load.load_points} load points (${s.training_load.avg_daily_load_points}/day).`;
  const hrv =
    s.hrv.latest_vs_mean_pct === null
      ? ""
      : `\nLatest HRV ${fmt(s.hrv.latest_ms)} ms is ${s.hrv.latest_vs_mean_pct > 0 ? "+" : ""}${s.hrv.latest_vs_mean_pct}% vs period mean; RHR ${fmt(
          s.resting_hr.latest_bpm,
        )} bpm (${s.resting_hr.latest_vs_mean_bpm !== null && s.resting_hr.latest_vs_mean_bpm > 0 ? "+" : ""}${s.resting_hr.latest_vs_mean_bpm ?? "?"} vs mean).`;
  return `${header}\n${sep}\n${body}\n\n${avg}\n${load}${hrv}`;
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : String(v);
}

/** Average heart-rate samples into fixed-size buckets (minutes). */
export function bucketHeartRate(
  samples: Json[],
  bucketMinutes: number,
): Array<{ timestamp: string; bpm_avg: number; bpm_min: number; bpm_max: number; samples: number }> {
  const size = Math.max(1, bucketMinutes) * 60_000;
  const buckets = new Map<number, { sum: number; min: number; max: number; n: number }>();
  for (const s of samples) {
    const t = Date.parse(String(s.timestamp ?? ""));
    const bpm = num(s.bpm);
    if (!Number.isFinite(t) || bpm === null) continue;
    const key = Math.floor(t / size) * size;
    const b = buckets.get(key) ?? { sum: 0, min: Infinity, max: -Infinity, n: 0 };
    b.sum += bpm;
    b.min = Math.min(b.min, bpm);
    b.max = Math.max(b.max, bpm);
    b.n++;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, b]) => ({
      timestamp: new Date(k).toISOString(),
      bpm_avg: Math.round(b.sum / b.n),
      bpm_min: b.min,
      bpm_max: b.max,
      samples: b.n,
    }));
}
