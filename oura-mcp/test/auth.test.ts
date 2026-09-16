import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenProvider, StaticTokenProvider, TokenStore, buildAuthorizeUrl, createTokenProvider } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "oura-mcp-")), "tokens.json");

test("loadConfig reads env with defaults and expands ~", () => {
  const c = loadConfig({ OURA_CLIENT_ID: "id", OURA_TOKEN_PATH: "~/x/tokens.json" });
  assert.equal(c.clientId, "id");
  assert.equal(c.redirectUri, "http://localhost:8484/callback");
  assert.ok(!c.tokenPath.startsWith("~"));
  assert.ok(c.tokenPath.endsWith("/x/tokens.json"));
  assert.equal(loadConfig({ OURA_TOKEN: "pat" }).accessToken, "pat");
});

test("TokenStore round-trips with 0600 permissions", () => {
  const path = tmp();
  const store = new TokenStore(path);
  assert.equal(store.read(), null);
  store.write({ access_token: "a", refresh_token: "r", expires_at: 1 });
  assert.deepEqual(store.read(), { access_token: "a", refresh_token: "r", expires_at: 1 });
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("createTokenProvider prefers OURA_ACCESS_TOKEN over the token file", () => {
  assert.ok(createTokenProvider(loadConfig({ OURA_ACCESS_TOKEN: "x" })) instanceof StaticTokenProvider);
  assert.ok(createTokenProvider(loadConfig({})) instanceof FileTokenProvider);
});

test("FileTokenProvider refreshes proactively before expiry and persists the result", async () => {
  const path = tmp();
  new TokenStore(path).write({ access_token: "old", refresh_token: "r1", scope: "daily", expires_at: 1_000 });
  const { fn, calls } = mockFetch({
    "/oauth/token": () => jsonResponse({ access_token: "new", refresh_token: "r2", expires_in: 86400, token_type: "bearer" }),
  });
  const config = loadConfig({ OURA_CLIENT_ID: "cid", OURA_CLIENT_SECRET: "sec", OURA_TOKEN_PATH: path });
  const provider = new FileTokenProvider(config, fn, () => 1_000 * 1000);
  assert.equal(await provider.getAccessToken(), "new");
  const body = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), "r1");
  assert.equal(body.get("client_id"), "cid");
  const stored = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(stored.access_token, "new");
  assert.equal(stored.refresh_token, "r2");
  assert.equal(stored.scope, "daily");
  const expected = Math.floor(Date.now() / 1000) + 86400;
  assert.ok(Math.abs(stored.expires_at - expected) <= 5, `expires_at ${stored.expires_at} should be ~${expected}`);
});

test("FileTokenProvider keeps the old refresh token when Oura omits it", async () => {
  const path = tmp();
  new TokenStore(path).write({ access_token: "old", refresh_token: "keep-me" });
  const { fn } = mockFetch({ "/oauth/token": () => jsonResponse({ access_token: "new", expires_in: 10 }) });
  const provider = new FileTokenProvider(loadConfig({ OURA_CLIENT_ID: "c", OURA_CLIENT_SECRET: "s", OURA_TOKEN_PATH: path }), fn);
  assert.equal(await provider.refresh(), "new");
  assert.equal(new TokenStore(path).read()?.refresh_token, "keep-me");
});

test("FileTokenProvider without a file explains how to authorize", async () => {
  const provider = new FileTokenProvider(loadConfig({ OURA_TOKEN_PATH: tmp() }));
  await assert.rejects(provider.getAccessToken(), /oura-mcp auth/);
});

test("StaticTokenProvider refreshes only when refresh token and client credentials exist", async () => {
  const { fn } = mockFetch({ "/oauth/token": () => jsonResponse({ access_token: "n", refresh_token: "r2" }) });
  const plain = new StaticTokenProvider(loadConfig({ OURA_ACCESS_TOKEN: "pat" }), fn);
  assert.equal(await plain.refresh(), null);
  const full = new StaticTokenProvider(
    loadConfig({ OURA_ACCESS_TOKEN: "a", OURA_REFRESH_TOKEN: "r", OURA_CLIENT_ID: "c", OURA_CLIENT_SECRET: "s" }),
    fn,
  );
  assert.equal(await full.refresh(), "n");
  assert.equal(await full.getAccessToken(), "n");
});

test("buildAuthorizeUrl encodes scopes, redirect and state", () => {
  const url = new URL(buildAuthorizeUrl(loadConfig({ OURA_CLIENT_ID: "cid", OURA_SCOPES: "daily heartrate" }), "st"));
  assert.equal(url.origin + url.pathname, "https://cloud.ouraring.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("scope"), "daily heartrate");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8484/callback");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("response_type"), "code");
});
