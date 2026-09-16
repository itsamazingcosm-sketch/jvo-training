import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOuraServer } from "../src/server.js";
import { OuraClient } from "../src/oura-client.js";
import { FakeAuth, jsonResponse, mockFetch } from "./helpers.js";

async function connect(fetchFn: typeof fetch) {
  const oura = new OuraClient(new FakeAuth(), { fetchFn, sleep: async () => {} });
  const server = createOuraServer(oura, { timezone: "UTC" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return { client, server };
}

function text(result: unknown): string {
  const c = (result as { content: Array<{ type: string; text: string }> }).content;
  return c[0].text;
}

test("lists all tools and prompts", async () => {
  const { client, server } = await connect(mockFetch({}).fn);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, [
    "oura_cardiovascular_age",
    "oura_daily_activity",
    "oura_daily_readiness",
    "oura_daily_resilience",
    "oura_daily_sleep",
    "oura_daily_spo2",
    "oura_daily_stress",
    "oura_dashboard",
    "oura_heart_rate",
    "oura_personal_info",
    "oura_raw_get",
    "oura_rest_mode_periods",
    "oura_ring_configuration",
    "oura_sessions",
    "oura_sleep_periods",
    "oura_sleep_time",
    "oura_tags",
    "oura_vo2_max",
    "oura_workouts",
  ]);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
  assert.deepEqual(prompts, ["oura_morning_briefing", "oura_weekly_review"]);
  await client.close();
  await server.close();
});

test("oura_daily_readiness passes the date window through and strips nothing", async () => {
  const { fn, calls } = mockFetch({
    "/v2/usercollection/daily_readiness": () =>
      jsonResponse({ data: [{ day: "2026-09-02", score: 88, contributors: { hrv_balance: 90 } }], next_token: null }),
  });
  const { client, server } = await connect(fn);
  const res = await client.callTool({ name: "oura_daily_readiness", arguments: { start_date: "2026-09-01", end_date: "2026-09-02" } });
  const body = JSON.parse(text(res));
  assert.equal(body.collection, "daily_readiness");
  assert.equal(body.count, 1);
  assert.equal(body.data[0].score, 88);
  assert.equal(calls[0].url.searchParams.get("start_date"), "2026-09-01");
  assert.equal(calls[0].url.searchParams.get("end_date"), "2026-09-02");
  await client.close();
  await server.close();
});

test("oura_sleep_periods strips series by default and keeps them on request", async () => {
  const record = { day: "2026-09-02", type: "long_sleep", average_hrv: 50, hrv: { interval: 300, items: [1, 2, 3] } };
  const { fn } = mockFetch({ "/v2/usercollection/sleep": () => jsonResponse({ data: [record] }) });
  const { client, server } = await connect(fn);
  const compact = JSON.parse(text(await client.callTool({ name: "oura_sleep_periods", arguments: { days: 1 } })));
  assert.equal(compact.data[0].hrv.omitted, true);
  const full = JSON.parse(text(await client.callTool({ name: "oura_sleep_periods", arguments: { days: 1, include_series: true } })));
  assert.deepEqual(full.data[0].hrv.items, [1, 2, 3]);
  await client.close();
  await server.close();
});

test("oura_heart_rate filters by source and buckets", async () => {
  const { fn, calls } = mockFetch({
    "/v2/usercollection/heartrate": () =>
      jsonResponse({
        data: [
          { bpm: 50, source: "sleep", timestamp: "2026-09-02T02:00:00+00:00" },
          { bpm: 54, source: "sleep", timestamp: "2026-09-02T02:30:00+00:00" },
          { bpm: 120, source: "awake", timestamp: "2026-09-02T09:00:00+00:00" },
        ],
      }),
  });
  const { client, server } = await connect(fn);
  const res = JSON.parse(
    text(
      await client.callTool({
        name: "oura_heart_rate",
        arguments: { start_datetime: "2026-09-02T00:00:00Z", end_datetime: "2026-09-02T12:00:00Z", source: "sleep", bucket_minutes: 60 },
      }),
    ),
  );
  assert.equal(calls[0].url.searchParams.get("start_datetime"), "2026-09-02T00:00:00Z");
  assert.deepEqual(res.stats, { samples: 2, min: 50, max: 54, avg: 52 });
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].bpm_avg, 52);
  await client.close();
  await server.close();
});

test("oura_dashboard tolerates a failing collection and renders markdown", async () => {
  const { fn } = mockFetch({
    "/v2/usercollection/daily_readiness": () => jsonResponse({ data: [{ day: "2026-09-02", score: 80 }] }),
    "/v2/usercollection/daily_sleep": () => jsonResponse({ data: [{ day: "2026-09-02", score: 70 }] }),
    "/v2/usercollection/sleep": () =>
      jsonResponse({ data: [{ day: "2026-09-02", type: "long_sleep", total_sleep_duration: 25200, average_hrv: 45, lowest_heart_rate: 50 }] }),
    "/v2/usercollection/daily_activity": () => jsonResponse({ data: [{ day: "2026-09-02", score: 60, steps: 5000 }] }),
    "/v2/usercollection/workout": () => jsonResponse({ data: [] }),
    "/v2/usercollection/daily_stress": () => jsonResponse({ data: [] }),
    "/v2/usercollection/daily_spo2": () => jsonResponse({ detail: "forbidden scope" }, 403),
    "/v2/usercollection/daily_resilience": () => jsonResponse({ data: [] }),
  });
  const { client, server } = await connect(fn);
  const json = JSON.parse(text(await client.callTool({ name: "oura_dashboard", arguments: { start_date: "2026-09-01", end_date: "2026-09-02" } })));
  assert.equal(json.rows.length, 1);
  assert.equal(json.rows[0].total_sleep_h, 7);
  assert.match(json.errors.daily_spo2, /HTTP 403/);
  const md = text(await client.callTool({ name: "oura_dashboard", arguments: { start_date: "2026-09-01", end_date: "2026-09-02", format: "markdown" } }));
  assert.match(md, /\| 2026-09-02 \| 80 \| 70 \| 60 \| 7 \|/);
  assert.match(md, /Unavailable collections/);
  await client.close();
  await server.close();
});

test("tool errors are returned as isError results, not protocol failures", async () => {
  const { fn } = mockFetch({ "/v2/usercollection/personal_info": () => jsonResponse({ detail: "nope" }, 401) });
  const { client, server } = await connect(fn);
  const res = await client.callTool({ name: "oura_personal_info", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(text(res), /HTTP 401/);
  const bad = await client.callTool({ name: "oura_daily_sleep", arguments: { start_date: "yesterday" } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /YYYY-MM-DD/);
  await client.close();
  await server.close();
});

test("oura_raw_get rejects paths outside /v2", async () => {
  const { client, server } = await connect(mockFetch({}).fn);
  const res = await client.callTool({ name: "oura_raw_get", arguments: { path: "/v1/anything" } });
  assert.equal(res.isError, true);
  await client.close();
  await server.close();
});
