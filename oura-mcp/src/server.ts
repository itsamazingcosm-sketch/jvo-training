import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveDateRange, resolveDateTimeRange } from "./config.js";
import { OuraClient, stripSeries, type Json } from "./oura-client.js";
import { buildDashboard, bucketHeartRate, dashboardMarkdown } from "./summaries.js";

export const SERVER_NAME = "oura-mcp";
export const SERVER_VERSION = "0.1.0";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (payload: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
const okText = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (e: unknown): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
});

const dateArgs = {
  start_date: z.string().optional().describe("YYYY-MM-DD. Defaults to end_date minus (days - 1)."),
  end_date: z.string().optional().describe("YYYY-MM-DD. Defaults to today."),
  days: z.number().int().min(1).max(366).optional().describe("Window length when start_date is omitted (default 7)."),
  next_token: z.string().optional().describe("Cursor from a previous response to continue paging."),
  max_pages: z.number().int().min(1).max(50).optional().describe("How many API pages to follow (default 10)."),
};

const seriesArg = {
  include_series: z
    .boolean()
    .optional()
    .describe("Include dense 5-min / 30-sec sample arrays (heart_rate, hrv, met, sleep phases). Default false to keep output small."),
};

export interface ServerOptions {
  timezone?: string;
}

export function createOuraServer(client: OuraClient, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const tz = opts.timezone;

  const collection = async (
    name: string,
    args: { start_date?: string; end_date?: string; days?: number; next_token?: string; max_pages?: number; include_series?: boolean },
  ) => {
    const range = resolveDateRange(args, tz);
    const res = await client.listByDate(name, range, { maxPages: args.max_pages, nextToken: args.next_token });
    const data = args.include_series ? res.data : res.data.map(stripSeries);
    return ok({ collection: name, ...range, count: data.length, next_token: res.next_token, data });
  };

  const registerCollection = (
    tool: string,
    name: string,
    description: string,
    extra: { series?: boolean } = {},
  ) => {
    server.registerTool(
      tool,
      {
        title: tool,
        description,
        inputSchema: extra.series ? { ...dateArgs, ...seriesArg } : dateArgs,
      },
      async (args) => {
        try {
          return await collection(name, args);
        } catch (e) {
          return fail(e);
        }
      },
    );
  };

  // ---------- profile ----------
  server.registerTool(
    "oura_personal_info",
    {
      title: "Personal info",
      description: "Profile of the connected Oura user: id, age, weight, height, biological_sex, email (needs `personal` scope).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.get("/v2/usercollection/personal_info"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- daily scores ----------
  registerCollection(
    "oura_daily_readiness",
    "daily_readiness",
    "Daily Readiness score (0-100) with contributors (hrv_balance, resting_heart_rate, sleep_balance, recovery_index, body_temperature, activity_balance, previous_night, previous_day_activity) and temperature_deviation. One record per day.",
  );
  registerCollection(
    "oura_daily_sleep",
    "daily_sleep",
    "Daily Sleep score (0-100) with contributors (deep_sleep, rem_sleep, total_sleep, efficiency, latency, restfulness, timing). One record per day. For durations, HRV and heart rate use oura_sleep_periods.",
  );
  registerCollection(
    "oura_daily_activity",
    "daily_activity",
    "Daily Activity: score, steps, active/total calories, equivalent_walking_distance, high/medium/low_activity_time (seconds), sedentary_time, target_calories, average_met_minutes. Optional 5-min MET series with include_series.",
    { series: true },
  );
  registerCollection(
    "oura_daily_stress",
    "daily_stress",
    "Daily Stress: stress_high and recovery_high (seconds of the day) plus day_summary (restored / normal / stressful).",
  );
  registerCollection(
    "oura_daily_resilience",
    "daily_resilience",
    "Daily Resilience level (limited / adequate / solid / strong / exceptional) with contributors (sleep_recovery, daytime_recovery, stress).",
  );
  registerCollection(
    "oura_daily_spo2",
    "daily_spo2",
    "Daily blood-oxygen during sleep: spo2_percentage.average and breathing_disturbance_index (needs `spo2` scope and a Gen3+ ring).",
  );
  registerCollection(
    "oura_cardiovascular_age",
    "daily_cardiovascular_age",
    "Daily estimated cardiovascular age (vascular_age) compared with chronological age.",
  );
  registerCollection(
    "oura_vo2_max",
    "vO2_max",
    "VO2 max estimates (ml/kg/min) per day when available.",
  );

  // ---------- sleep detail ----------
  registerCollection(
    "oura_sleep_periods",
    "sleep",
    "Detailed sleep periods (type long_sleep / short_sleep / rest / late_nap): bedtime_start/end, total_sleep_duration, time_in_bed, deep/rem/light_sleep_duration, awake_time (all seconds), efficiency, latency, average_hrv (ms), lowest_heart_rate, average_heart_rate, average_breath, readiness snapshot. Use include_series for 5-min HRV/HR and sleep-phase strings. A day can have several periods.",
    { series: true },
  );
  registerCollection(
    "oura_sleep_time",
    "sleep_time",
    "Recommended bedtime window per day (optimal_bedtime start/end offsets, recommendation, status).",
  );
  registerCollection(
    "oura_rest_mode_periods",
    "rest_mode_period",
    "Rest Mode periods (start_day, end_day, episodes) when the user enabled Rest Mode.",
  );

  // ---------- training ----------
  registerCollection(
    "oura_workouts",
    "workout",
    "Workouts (auto-detected and manually logged): activity, intensity (easy / moderate / hard), start/end_datetime, calories, distance, label, source. Needs `workout` scope.",
  );
  registerCollection(
    "oura_sessions",
    "session",
    "Guided/unguided sessions (meditation, breathing, nap, relaxation, rest): type, start/end_datetime, mood, and with include_series the heart_rate / hrv / motion_count series. Needs `session` scope.",
    { series: true },
  );
  registerCollection(
    "oura_tags",
    "enhanced_tag",
    "User tags and notes (tag_type_code, comment, start/end_day, start/end_time, custom_name). Needs `tag` scope.",
  );

  // ---------- ring ----------
  registerCollection(
    "oura_ring_configuration",
    "ring_configuration",
    "Ring hardware info: color, design, firmware_version, hardware_type, size, set_up_at. Date filters are ignored by the API for this collection.",
  );

  // ---------- heart rate time series ----------
  server.registerTool(
    "oura_heart_rate",
    {
      title: "Heart rate time series",
      description:
        "Heart-rate samples (bpm, source: awake / rest / sleep / session / live, timestamp), roughly every 5 minutes. Defaults to the last 24 hours. Use bucket_minutes to average into larger buckets (e.g. 60 for an hourly chart) and keep the response small. Needs `heartrate` scope.",
      inputSchema: {
        start_datetime: z.string().optional().describe("ISO 8601, e.g. 2026-09-15T00:00:00+03:00"),
        end_datetime: z.string().optional().describe("ISO 8601. Defaults to now."),
        hours: z.number().min(1).max(24 * 31).optional().describe("Window length when start_datetime is omitted (default 24)."),
        bucket_minutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .optional()
          .describe("Average samples into buckets of this many minutes. Omit for raw samples."),
        source: z.enum(["awake", "rest", "sleep", "session", "live"]).optional().describe("Keep only samples from this source."),
        max_pages: dateArgs.max_pages,
      },
    },
    async (args) => {
      try {
        const range = resolveDateTimeRange(args);
        const res = await client.listByDateTime("heartrate", range, { maxPages: args.max_pages ?? 20 });
        let samples = res.data;
        if (args.source) samples = samples.filter((s) => s.source === args.source);
        const bpm = samples.map((s) => s.bpm).filter((v): v is number => typeof v === "number");
        const stats = bpm.length
          ? {
              samples: bpm.length,
              min: Math.min(...bpm),
              max: Math.max(...bpm),
              avg: Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length),
            }
          : { samples: 0 };
        const data = args.bucket_minutes ? bucketHeartRate(samples, args.bucket_minutes) : samples;
        return ok({ ...range, stats, next_token: res.next_token, bucket_minutes: args.bucket_minutes ?? null, data });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- composite dashboard ----------
  server.registerTool(
    "oura_dashboard",
    {
      title: "Dashboard summary",
      description:
        "One call for a readiness / sleep / HRV / training-load dashboard. For each day in the window returns readiness, sleep and activity scores, sleep durations and stages, average HRV, lowest (resting) HR, temperature deviation, steps, calories, workouts (count, minutes, calories, types), stress/recovery minutes and SpO2, plus period averages, HRV and RHR vs. the period mean, and a simple training-load tally (minutes x intensity). Default window: last 7 days. Use format=markdown for a compact table.",
      inputSchema: {
        start_date: dateArgs.start_date,
        end_date: dateArgs.end_date,
        days: dateArgs.days,
        format: z.enum(["json", "markdown"]).optional().describe("json (default) or markdown table"),
      },
    },
    async (args) => {
      try {
        const range = resolveDateRange(args, tz);
        const pull = (name: string) => client.listByDate<Json>(name, range, { maxPages: 20 }).then((r) => r.data);
        const settled = await Promise.allSettled([
          pull("daily_readiness"),
          pull("daily_sleep"),
          pull("sleep"),
          pull("daily_activity"),
          pull("workout"),
          pull("daily_stress"),
          pull("daily_spo2"),
          pull("daily_resilience"),
        ]);
        const names = ["daily_readiness", "daily_sleep", "sleep", "daily_activity", "workout", "daily_stress", "daily_spo2", "daily_resilience"];
        const errors: Record<string, string> = {};
        const take = (i: number): Json[] => {
          const s = settled[i];
          if (s.status === "fulfilled") return s.value;
          errors[names[i]] = s.reason instanceof Error ? s.reason.message : String(s.reason);
          return [];
        };
        const [readiness, dailySleep, sleepPeriods, activity, workouts, stress, spo2, resilience] = names.map((_, i) => take(i));
        if (Object.keys(errors).length === names.length) {
          return fail(`All Oura requests failed: ${JSON.stringify(errors)}`);
        }
        const summary = buildDashboard({ range, readiness, dailySleep, sleepPeriods, activity, workouts, stress, spo2, resilience });
        if (args.format === "markdown") {
          const warn = Object.keys(errors).length ? `\n\nUnavailable collections: ${JSON.stringify(errors)}` : "";
          return okText(dashboardMarkdown(summary) + warn);
        }
        return ok(Object.keys(errors).length ? { ...summary, errors } : summary);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- escape hatch ----------
  server.registerTool(
    "oura_raw_get",
    {
      title: "Raw GET",
      description:
        "GET any Oura API v2 path with query parameters, e.g. path='/v2/usercollection/daily_sleep/{document_id}' or a collection with start_date/end_date/next_token. Returns the JSON body as is.",
      inputSchema: {
        path: z.string().regex(/^\/v2\/[A-Za-z0-9_\-/{}]+$/, "path must start with /v2/"),
        params: z.record(z.union([z.string(), z.number()])).optional().describe("Query parameters"),
      },
    },
    async ({ path, params }) => {
      try {
        return ok(await client.get(path, params ?? {}));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- prompts ----------
  server.registerPrompt(
    "oura_morning_briefing",
    {
      title: "Morning briefing",
      description: "Short readiness-first briefing for today with 2-3 practical suggestions.",
      argsSchema: { focus: z.string().optional().describe("Optional focus: sleep, training, recovery, HRV") },
    },
    ({ focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Call oura_dashboard with days=7, then oura_sleep_periods with days=1 if last night needs detail. Write a short morning briefing${focus ? ` focused on ${focus}` : ""}: today's readiness vs the week, last night's sleep (duration, stages, HRV, resting HR, temperature deviation), what changed, and 2-3 concrete suggestions for today's training load. No medical diagnoses. Keep it under 150 words.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "oura_weekly_review",
    {
      title: "Weekly review",
      description: "Trend review of the last weeks: sleep, readiness, HRV, resting HR, training load.",
      argsSchema: { weeks: z.string().optional().describe("How many weeks to review (default 2)") },
    },
    ({ weeks }) => {
      const n = Math.max(1, Number(weeks) || 2);
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Call oura_dashboard with days=${n * 7} and oura_workouts with days=${n * 7}. Review trends in sleep score and duration, readiness, average HRV, lowest heart rate, temperature deviation and training load (minutes by intensity and type). Point out the best and worst days and what preceded them, and propose next week's training/recovery plan in 3-5 bullets. No medical diagnoses.`,
            },
          },
        ],
      };
    },
  );

  return server;
}
