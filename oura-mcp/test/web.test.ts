import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createWebServer } from "../src/web.js";
import { loadConfig } from "../src/config.js";
import { TokenStore } from "../src/auth.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const publicDir = join(process.cwd(), "public");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

async function boot(env: Record<string, string>, routes: Parameters<typeof mockFetch>[0] = {}) {
  const tokenPath = join(mkdtempSync(join(tmpdir(), "oura-web-")), "tokens.json");
  const config = loadConfig({ OURA_TOKEN_PATH: tokenPath, SESSION_SECRET: "s3cret", OURA_TIMEZONE: "UTC", ...env });
  const { fn, calls } = mockFetch(routes);
  const server = createWebServer(config, { fetchFn: fn, publicDir, log: () => {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => new Promise<void>((r) => server.close(() => r()));
  const get = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: "manual", ...init });
  return { base, get, close, calls, tokenPath, config };
}

async function login(get: (p: string, i?: RequestInit) => Promise<Response>, password: string) {
  const res = await get("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }).toString(),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { res, cookie };
}

test("password gate: redirects, rejects wrong password, accepts the right one", async () => {
  const { get, close } = await boot({ DASHBOARD_PASSWORD: "pw", OURA_ACCESS_TOKEN: "tok" });
  try {
    assert.equal((await get("/healthz")).status, 200);
    const home = await get("/");
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/login");
    assert.equal((await get("/api/dashboard")).status, 401);
    assert.equal((await login(get, "wrong")).res.status, 401);
    const { res, cookie } = await login(get, "pw");
    assert.equal(res.status, 302);
    assert.match(cookie, /^oura_dash=/);
    const page = await get("/", { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Oura · Дашборд/);
    const out = await get("/logout", { headers: { cookie } });
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
  } finally {
    await close();
  }
});

test("no password configured: dashboard is open", async () => {
  const { get, close } = await boot({ OURA_ACCESS_TOKEN: "tok" });
  try {
    assert.equal((await get("/")).status, 200);
    assert.equal((await get("/login")).status, 302);
  } finally {
    await close();
  }
});

test("/api/status and /api/dashboard with a static token", async () => {
  const day = (n: string) => ({ day: n });
  const { get, close, calls } = await boot(
    { OURA_ACCESS_TOKEN: "tok" },
    {
      "/v2/usercollection/daily_readiness": () => jsonResponse({ data: [{ ...day("2026-09-15"), score: 80 }] }),
      "/v2/usercollection/daily_sleep": () => jsonResponse({ data: [{ ...day("2026-09-15"), score: 70 }] }),
      "/v2/usercollection/sleep": () => jsonResponse({ data: [{ ...day("2026-09-15"), type: "long_sleep", total_sleep_duration: 25200, average_hrv: 44 }] }),
      "/v2/usercollection/daily_activity": () => jsonResponse({ data: [] }),
      "/v2/usercollection/workout": () => jsonResponse({ data: [] }),
      "/v2/usercollection/daily_stress": () => jsonResponse({ data: [] }),
      "/v2/usercollection/daily_spo2": () => jsonResponse({ detail: "no" }, 403),
      "/v2/usercollection/daily_resilience": () => jsonResponse({ data: [] }),
    },
  );
  try {
    const status = await json(await get("/api/status"));
    assert.equal(status.connected, true);
    assert.equal(status.can_connect, false);
    const res = await get("/api/dashboard?days=3&end_date=2026-09-16");
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.deepEqual(body.range, { start_date: "2026-09-14", end_date: "2026-09-16", days_with_data: 1 });
    assert.equal(body.rows[0].readiness_score, 80);
    assert.equal(body.rows[0].total_sleep_h, 7);
    assert.match(body.errors.daily_spo2, /403/);
    assert.ok(calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === "Bearer tok"));
    assert.equal((await get("/api/nope")).status, 404);
  } finally {
    await close();
  }
});

test("OAuth connect flow: state cookie, callback validation, token persistence", async () => {
  const { get, close, calls, tokenPath, config } = await boot(
    { OURA_CLIENT_ID: "cid", OURA_CLIENT_SECRET: "sec", PUBLIC_URL: "http://dash.local" },
    { "/oauth/token": () => jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }) },
  );
  try {
    assert.equal(config.redirectUri, "http://dash.local/callback");
    const status = await json(await get("/api/status"));
    assert.equal(status.connected, false);
    assert.equal(status.can_connect, true);
    assert.equal((await get("/api/dashboard")).status, 409);

    const connect = await get("/connect");
    assert.equal(connect.status, 302);
    const authorize = new URL(connect.headers.get("location")!);
    assert.equal(authorize.origin + authorize.pathname, "https://cloud.ouraring.com/oauth/authorize");
    assert.equal(authorize.searchParams.get("client_id"), "cid");
    assert.equal(authorize.searchParams.get("redirect_uri"), "http://dash.local/callback");
    const state = authorize.searchParams.get("state")!;
    const stateCookie = connect.headers.get("set-cookie")!.split(";")[0];

    assert.equal((await get(`/callback?code=abc&state=wrong`, { headers: { cookie: stateCookie } })).status, 400);
    assert.equal((await get(`/callback?code=abc&state=${state}`)).status, 400);
    const denied = await get(`/callback?error=access_denied&state=${state}`, { headers: { cookie: stateCookie } });
    assert.equal(denied.status, 400);

    const ok = await get(`/callback?code=abc&state=${state}&scope=daily`, { headers: { cookie: stateCookie } });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "/");
    const tokenCall = calls.find((c) => c.url.pathname === "/oauth/token")!;
    const body = new URLSearchParams(String(tokenCall.init?.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "abc");
    assert.equal(body.get("redirect_uri"), "http://dash.local/callback");
    const stored = new TokenStore(tokenPath).read()!;
    assert.equal(stored.access_token, "acc");
    assert.equal(stored.refresh_token, "ref");
    assert.equal(stored.scope, "daily");
    assert.equal((await json(await get("/api/status"))).connected, true);
  } finally {
    await close();
  }
});
