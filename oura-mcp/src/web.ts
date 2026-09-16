import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDateRange, type OuraConfig } from "./config.js";
import { buildAuthorizeUrl, createTokenProvider, exchangeCode, TokenStore } from "./auth.js";
import { OuraClient, type Json } from "./oura-client.js";
import { buildDashboard } from "./summaries.js";

const SESSION_COOKIE = "oura_dash";
const STATE_COOKIE = "oura_state";
const SESSION_TTL_SEC = 30 * 24 * 3600;

export interface WebOptions {
  fetchFn?: typeof fetch;
  /** Directory with index.html (defaults to ../public next to dist/). */
  publicDir?: string;
  log?: (msg: string) => void;
}

// ---------- signed cookies ----------

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function makeToken(secret: string, data: Record<string, string | number>): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

function readToken(secret: string, token: string | undefined): Record<string, string | number> | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(secret, payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, opts: { maxAge?: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function loginPage(error?: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oura · вход</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f9f9f7;color:#0b0b0b;display:grid;place-items:center;min-height:100vh;margin:0}
@media(prefers-color-scheme:dark){body{background:#0d0d0d;color:#fff}input{background:#1a1a19;color:#fff;border-color:#383835}}
form{display:grid;gap:12px;width:min(320px,90vw)}h1{font-size:20px;margin:0 0 4px}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #c3c2b7}
button{background:#2a78d6;color:#fff;border:0;cursor:pointer}.err{color:#d03b3b;font-size:14px}</style></head>
<body><form method="post" action="/login"><h1>Oura дашборд</h1><label>Пароль<br><input type="password" name="password" autofocus required></label>${
    error ? `<div class="err">${escapeHtml(error)}</div>` : ""
  }<button type="submit">Войти</button></form></body></html>`;
}

// ---------- server ----------

export function createWebServer(config: OuraConfig, opts: WebOptions = {}): Server {
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? ((m) => console.error(m));
  const secret = config.sessionSecret ?? randomBytes(32).toString("hex");
  if (!config.sessionSecret) log("[oura-web] SESSION_SECRET is not set: sessions will reset on restart");
  if (!config.dashboardPassword) log("[oura-web] DASHBOARD_PASSWORD is not set: the dashboard is open to anyone who can reach this port");
  const secure = (config.publicUrl ?? "").startsWith("https://");
  const publicDir = opts.publicDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  const store = new TokenStore(config.tokenPath);
  const client = new OuraClient(createTokenProvider(config, fetchFn), { fetchFn, baseUrl: config.apiBase });

  const hasSession = (req: IncomingMessage): boolean => {
    if (!config.dashboardPassword) return true;
    const data = readToken(secret, parseCookies(req)[SESSION_COOKIE]);
    return !!data && typeof data.exp === "number" && data.exp > Date.now() / 1000;
  };
  const isConnected = (): boolean => !!config.accessToken || !!store.read();

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const sendHtml = (res: ServerResponse, status: number, html: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(html);
  };
  const redirect = (res: ServerResponse, to: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(302, { Location: to, ...headers });
    res.end();
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      if (path === "/healthz") return sendJson(res, 200, { ok: true });

      // ----- password gate -----
      if (path === "/login") {
        if (!config.dashboardPassword) return redirect(res, "/");
        if (req.method === "POST") {
          const form = new URLSearchParams(await readBody(req));
          if (safeEqual(form.get("password") ?? "", config.dashboardPassword)) {
            const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
            return redirect(res, "/", { "Set-Cookie": cookie(SESSION_COOKIE, makeToken(secret, { exp }), { maxAge: SESSION_TTL_SEC, secure }) });
          }
          await new Promise((r) => setTimeout(r, 500));
          return sendHtml(res, 401, loginPage("Неверный пароль"));
        }
        return sendHtml(res, 200, loginPage());
      }
      if (path === "/logout") {
        return redirect(res, "/login", { "Set-Cookie": cookie(SESSION_COOKIE, "", { maxAge: 0, secure }) });
      }
      if (!hasSession(req)) {
        if (path.startsWith("/api/")) return sendJson(res, 401, { error: "unauthorized" });
        return redirect(res, "/login");
      }

      // ----- Oura OAuth connect -----
      if (path === "/connect") {
        if (config.accessToken) return redirect(res, "/");
        if (!config.clientId || !config.clientSecret) {
          return sendHtml(res, 500, "<p>OURA_CLIENT_ID / OURA_CLIENT_SECRET не заданы на сервере.</p>");
        }
        const state = randomBytes(16).toString("hex");
        return redirect(res, buildAuthorizeUrl(config, state), {
          "Set-Cookie": cookie(STATE_COOKIE, makeToken(secret, { state, exp: Math.floor(Date.now() / 1000) + 600 }), { maxAge: 600, secure }),
        });
      }
      if (path === new URL(config.redirectUri).pathname) {
        const expected = readToken(secret, parseCookies(req)[STATE_COOKIE]);
        const state = url.searchParams.get("state");
        const clear = cookie(STATE_COOKIE, "", { maxAge: 0, secure });
        if (!expected || !state || expected.state !== state || Number(expected.exp) < Date.now() / 1000) {
          return sendHtml(res, 400, "<p>Неверный или устаревший state. <a href='/connect'>Попробовать снова</a></p>", { "Set-Cookie": clear });
        }
        const err = url.searchParams.get("error");
        if (err) return sendHtml(res, 400, `<p>Oura отклонила авторизацию: ${escapeHtml(err)}. <a href='/connect'>Повторить</a></p>`, { "Set-Cookie": clear });
        const code = url.searchParams.get("code");
        if (!code) return sendHtml(res, 400, "<p>В ответе нет кода авторизации.</p>", { "Set-Cookie": clear });
        const tokens = await exchangeCode(config, code, fetchFn);
        if (!tokens.scope) tokens.scope = url.searchParams.get("scope") ?? undefined;
        store.write(tokens);
        log("[oura-web] Oura account connected");
        return redirect(res, "/", { "Set-Cookie": clear });
      }
      if (path === "/disconnect" && req.method === "POST") {
        store.write({ access_token: "" });
        return redirect(res, "/");
      }

      // ----- API -----
      if (path === "/api/status") {
        const stored = config.accessToken ? null : store.read();
        return sendJson(res, 200, {
          connected: isConnected(),
          source: client.auth.source,
          scope: stored?.scope ?? null,
          expires_at: stored?.expires_at ?? null,
          timezone: config.timezone ?? null,
          can_connect: !config.accessToken && !!config.clientId && !!config.clientSecret,
        });
      }
      if (path === "/api/dashboard") {
        if (!isConnected()) return sendJson(res, 409, { error: "not_connected" });
        const daysRaw = Number(url.searchParams.get("days") ?? 14);
        const days = Number.isFinite(daysRaw) ? Math.min(366, Math.max(1, Math.floor(daysRaw))) : 14;
        const range = resolveDateRange({ days, end_date: url.searchParams.get("end_date") ?? undefined }, config.timezone);
        const names = ["daily_readiness", "daily_sleep", "sleep", "daily_activity", "workout", "daily_stress", "daily_spo2", "daily_resilience"];
        const settled = await Promise.allSettled(names.map((n) => client.listByDate<Json>(n, range, { maxPages: 20 }).then((r) => r.data)));
        const errors: Record<string, string> = {};
        const got = settled.map((s, i) => {
          if (s.status === "fulfilled") return s.value;
          errors[names[i]] = s.reason instanceof Error ? s.reason.message : String(s.reason);
          return [] as Json[];
        });
        if (Object.keys(errors).length === names.length) return sendJson(res, 502, { error: "oura_failed", errors });
        const [readiness, dailySleep, sleepPeriods, activity, workouts, stress, spo2, resilience] = got;
        const summary = buildDashboard({ range, readiness, dailySleep, sleepPeriods, activity, workouts, stress, spo2, resilience });
        return sendJson(res, 200, { ...summary, errors, generated_at: new Date().toISOString() });
      }
      if (path.startsWith("/api/")) return sendJson(res, 404, { error: "not_found" });

      // ----- page -----
      if (path === "/" || path === "/index.html") {
        const html = readFileSync(join(publicDir, "index.html"), "utf8");
        return sendHtml(res, 200, html);
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    } catch (e) {
      log(`[oura-web] ${req.method} ${path}: ${(e as Error).message}`);
      if (path.startsWith("/api/")) return sendJson(res, 500, { error: (e as Error).message });
      sendHtml(res, 500, `<p>Ошибка: ${escapeHtml((e as Error).message)}</p>`);
    }
  });
}

export function startWebServer(config: OuraConfig, opts: WebOptions = {}): Promise<Server> {
  const server = createWebServer(config, opts);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", () => {
      const where = config.publicUrl ?? `http://localhost:${config.port}`;
      console.error(`[oura-web] dashboard on ${where} (port ${config.port}); OAuth redirect: ${config.redirectUri}`);
      resolve(server);
    });
  });
}
