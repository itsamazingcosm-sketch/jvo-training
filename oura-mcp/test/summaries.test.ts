import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboard, bucketHeartRate, dashboardMarkdown, pickMainSleep } from "../src/summaries.js";

const range = { start_date: "2026-09-01", end_date: "2026-09-03" };

const input = {
  range,
  readiness: [
    { day: "2026-09-01", score: 70, temperature_deviation: -0.1, contributors: { hrv_balance: 60, recovery_index: 80 } },
    { day: "2026-09-02", score: 90, temperature_deviation: 0.2, contributors: { hrv_balance: 90, recovery_index: 95 } },
  ],
  dailySleep: [
    { day: "2026-09-01", score: 65 },
    { day: "2026-09-02", score: 85 },
  ],
  sleepPeriods: [
    { day: "2026-09-01", type: "rest", total_sleep_duration: 1800, average_hrv: 99 },
    {
      day: "2026-09-01",
      type: "long_sleep",
      total_sleep_duration: 6 * 3600,
      time_in_bed: 7 * 3600,
      deep_sleep_duration: 3600,
      rem_sleep_duration: 5400,
      light_sleep_duration: 3 * 3600 + 1800,
      awake_time: 3600,
      efficiency: 86,
      latency: 600,
      average_hrv: 40,
      lowest_heart_rate: 52,
      average_heart_rate: 58,
      bedtime_start: "2026-08-31T23:00:00+03:00",
      bedtime_end: "2026-09-01T06:00:00+03:00",
    },
    { day: "2026-09-02", type: "long_sleep", total_sleep_duration: 8 * 3600, average_hrv: 60, lowest_heart_rate: 48 },
  ],
  activity: [
    { day: "2026-09-01", score: 75, steps: 8000, active_calories: 400, total_calories: 2400, high_activity_time: 600 },
    { day: "2026-09-02", score: 95, steps: 12000, active_calories: 700, total_calories: 2700 },
  ],
  workouts: [
    { day: "2026-09-01", activity: "running", intensity: "hard", start_datetime: "2026-09-01T18:00:00Z", end_datetime: "2026-09-01T18:45:00Z", calories: 500 },
    { day: "2026-09-02", activity: "cycling", intensity: "easy", start_datetime: "2026-09-02T07:00:00Z", end_datetime: "2026-09-02T08:00:00Z", calories: 300 },
  ],
  stress: [{ day: "2026-09-01", stress_high: 3600, recovery_high: 7200, day_summary: "normal" }],
  spo2: [{ day: "2026-09-01", spo2_percentage: { average: 97.5 } }],
  resilience: [{ day: "2026-09-02", level: "solid" }],
};

test("pickMainSleep prefers long_sleep, else the longest period", () => {
  assert.equal(pickMainSleep(input.sleepPeriods.filter((p) => p.day === "2026-09-01"))?.average_hrv, 40);
  assert.equal(pickMainSleep([{ type: "rest", total_sleep_duration: 10 }, { type: "rest", total_sleep_duration: 20 }])?.total_sleep_duration, 20);
  assert.equal(pickMainSleep([]), undefined);
});

test("buildDashboard merges collections per day and computes aggregates", () => {
  const s = buildDashboard(input);
  assert.equal(s.rows.length, 2);
  const d1 = s.rows[0];
  assert.equal(d1.day, "2026-09-01");
  assert.equal(d1.readiness_score, 70);
  assert.equal(d1.total_sleep_h, 6);
  assert.equal(d1.deep_min, 60);
  assert.equal(d1.rem_min, 90);
  assert.equal(d1.awake_min, 60);
  assert.equal(d1.sleep_latency_min, 10);
  assert.equal(d1.avg_hrv_ms, 40);
  assert.equal(d1.lowest_hr_bpm, 52);
  assert.equal(d1.high_activity_min, 10);
  assert.equal(d1.workouts, 1);
  assert.equal(d1.workout_min, 45);
  assert.deepEqual(d1.workout_types, ["running"]);
  assert.equal(d1.stress_high_min, 60);
  assert.equal(d1.spo2_avg, 97.5);
  assert.equal(d1.hrv_balance, 60);
  assert.equal(s.rows[1].resilience_level, "solid");

  assert.equal(s.averages.readiness_score, 80);
  assert.equal(s.averages.avg_hrv_ms, 50);
  assert.equal(s.hrv.latest_ms, 60);
  assert.equal(s.hrv.latest_vs_mean_pct, 20);
  assert.equal(s.resting_hr.latest_vs_mean_bpm, -2);

  assert.equal(s.training_load.workouts, 2);
  assert.equal(s.training_load.total_minutes, 105);
  assert.equal(s.training_load.total_calories, 800);
  assert.deepEqual(s.training_load.minutes_by_intensity, { hard: 45, easy: 60 });
  assert.equal(s.training_load.load_points, 45 * 3 + 60);
  assert.equal(s.training_load.avg_daily_load_points, 65);
  assert.equal(s.range.days_with_data, 2);
});

test("buildDashboard ignores records outside the window", () => {
  const s = buildDashboard({ ...input, readiness: [...input.readiness, { day: "2026-08-01", score: 1 }] });
  assert.equal(s.rows.length, 2);
});

test("dashboardMarkdown renders a table with one row per day", () => {
  const md = dashboardMarkdown(buildDashboard(input));
  const lines = md.split("\n");
  assert.match(lines[0], /^\| day \| ready \| sleep/);
  assert.match(lines[2], /^\| 2026-09-01 \| 70 \| 65 \| 75 \| 6 \| 86 \| 40 \| 52 \| -0.1 \| 8000 \| 45 \| 60 \|$/);
  assert.match(md, /Training load: 2 workouts, 105 min/);
  assert.match(md, /\+20% vs period mean/);
});

test("bucketHeartRate averages samples into aligned buckets", () => {
  const samples = [
    { timestamp: "2026-09-01T10:01:00Z", bpm: 60 },
    { timestamp: "2026-09-01T10:31:00Z", bpm: 70 },
    { timestamp: "2026-09-01T11:05:00Z", bpm: 100 },
    { timestamp: "bad", bpm: 999 },
  ];
  const out = bucketHeartRate(samples, 60);
  assert.deepEqual(out, [
    { timestamp: "2026-09-01T10:00:00.000Z", bpm_avg: 65, bpm_min: 60, bpm_max: 70, samples: 2 },
    { timestamp: "2026-09-01T11:00:00.000Z", bpm_avg: 100, bpm_min: 100, bpm_max: 100, samples: 1 },
  ]);
});
