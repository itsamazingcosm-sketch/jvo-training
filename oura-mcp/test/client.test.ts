import { test } from "node:test";
import assert from "node:assert/strict";
import { OuraClient, OuraApiError, stripSeries } from "../src/oura-client.js";
import { FakeAuth, jsonResponse, mockFetch } from "./helpers.js";

const noSleep = async () => {};

test("list follows next_token and stops when exhausted", async () => {
  const { fn, calls } = mockFetch({
    "/v2/usercollection/daily_sleep": (url) => {
      const token = url.searchParams.get("next_token");
      if (!token) return jsonResponse({ data: [{ day: "2026-09-01" }], next_token: "p2" });
      if (token === "p2") return jsonResponse({ data: [{ day: "2026-09-02" }], next_token: null });
      throw new Error("unexpected token");
    },
  });
  const client = new OuraClient(new FakeAuth(), { fetchFn: fn, sleep: noSleep });
  const res = await client.listByDate("daily_sleep", { start_date: "2026-09-01", end_date: "2026-09-02" });
  assert.equal(res.data.length, 2);
  assert.equal(res.pages_fetched, 2);
  assert.equal(res.next_token, undefined);
  assert.equal(calls[0].url.searchParams.get("start_date"), "2026-09-01");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer token-1");
});

test("list respects maxPages and returns the cursor", async () => {
  const { fn } = mockFetch({
    "/v2/usercollection/workout": () => jsonResponse({ data: [{ day: "x" }], next_token: "more" }),
  });
  const client = new OuraClient(new FakeAuth(), { fetchFn: fn, sleep: noSleep });
  const res = await client.listByDate("workout", { start_date: "2026-09-01", end_date: "2026-09-02" }, { maxPages: 2 });
  assert.equal(res.data.length, 2);
  assert.equal(res.next_token, "more");
});

test("401 triggers one token refresh and a retry with the new token", async () => {
  let n = 0;
  const { fn, calls } = mockFetch({
    "/v2/usercollection/personal_info": (_url, init) => {
      n++;
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer token-2" ? jsonResponse({ id: "u1" }) : jsonResponse({ detail: "expired" }, 401);
    },
  });
  const auth = new FakeAuth("token-1", "token-2");
  const client = new OuraClient(auth, { fetchFn: fn, sleep: noSleep });
  const info = await client.get<{ id: string }>("/v2/usercollection/personal_info");
  assert.equal(info.id, "u1");
  assert.equal(auth.refreshCalls, 1);
  assert.equal(n, 2);
  assert.equal(calls.length, 2);
});

test("401 without a refreshable token surfaces as OuraApiError", async () => {
  const { fn } = mockFetch({ "/v2/usercollection/personal_info": () => jsonResponse({ detail: "bad token" }, 401) });
  const client = new OuraClient(new FakeAuth("pat", null), { fetchFn: fn, sleep: noSleep });
  await assert.rejects(client.get("/v2/usercollection/personal_info"), (e: unknown) => {
    assert.ok(e instanceof OuraApiError);
    assert.equal(e.status, 401);
    return true;
  });
});

test("429 is retried honouring Retry-After, then succeeds", async () => {
  let n = 0;
  const waits: number[] = [];
  const { fn } = mockFetch({
    "/v2/usercollection/heartrate": () =>
      ++n < 3 ? jsonResponse({ detail: "slow down" }, 429, { "retry-after": "2" }) : jsonResponse({ data: [] }),
  });
  const client = new OuraClient(new FakeAuth(), { fetchFn: fn, sleep: async (ms) => void waits.push(ms), maxAttempts: 3 });
  const res = await client.get("/v2/usercollection/heartrate");
  assert.deepEqual(res, { data: [] });
  assert.deepEqual(waits, [2000, 2000]);
});

test("gives up after maxAttempts on 503", async () => {
  const { fn } = mockFetch({ "/v2/usercollection/heartrate": () => jsonResponse({ detail: "down" }, 503) });
  const client = new OuraClient(new FakeAuth(), { fetchFn: fn, sleep: noSleep, maxAttempts: 2 });
  await assert.rejects(client.get("/v2/usercollection/heartrate"), /HTTP 503/);
});

test("stripSeries replaces dense arrays with a stub and keeps everything else", () => {
  const rec = {
    day: "2026-09-01",
    average_hrv: 55,
    hrv: { interval: 300, items: [50, 60, null], timestamp: "t" },
    sleep_phase_5_min: "1122334",
    readiness: { score: 80 },
  };
  const out = stripSeries(rec) as Record<string, unknown>;
  assert.equal(out.average_hrv, 55);
  assert.deepEqual(out.readiness, { score: 80 });
  assert.deepEqual(out.hrv, { omitted: true, samples: 3, interval: 300, hint: "pass include_series=true" });
  assert.deepEqual(out.sleep_phase_5_min, { omitted: true, length: 7, hint: "pass include_series=true" });
});
