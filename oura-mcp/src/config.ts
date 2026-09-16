import { homedir } from "node:os";
import { join } from "node:path";

export const OURA_API_BASE = "https://api.ouraring.com";
export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_APPLICATIONS_URL = "https://cloud.ouraring.com/oauth/applications";

export const DEFAULT_REDIRECT_URI = "http://localhost:8484/callback";
export const DEFAULT_SCOPES = "personal daily heartrate workout session tag spo2";

export interface OuraConfig {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
  tokenPath: string;
  timezone?: string;
  /** Override for tests / mocks, default https://api.ouraring.com */
  apiBase: string;
  /** Web dashboard */
  port: number;
  publicUrl?: string;
  dashboardPassword?: string;
  sessionSecret?: string;
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OuraConfig {
  const publicUrl = clean(env.PUBLIC_URL)?.replace(/\/+$/, "");
  const port = Number(clean(env.PORT) ?? 8484);
  const defaultRedirect = publicUrl ? `${publicUrl}/callback` : port === 8484 ? DEFAULT_REDIRECT_URI : `http://localhost:${port}/callback`;
  return {
    accessToken: clean(env.OURA_ACCESS_TOKEN) ?? clean(env.OURA_TOKEN),
    refreshToken: clean(env.OURA_REFRESH_TOKEN),
    clientId: clean(env.OURA_CLIENT_ID),
    clientSecret: clean(env.OURA_CLIENT_SECRET),
    redirectUri: clean(env.OURA_REDIRECT_URI) ?? defaultRedirect,
    port: Number.isFinite(port) && port > 0 ? port : 8484,
    publicUrl,
    dashboardPassword: clean(env.DASHBOARD_PASSWORD),
    sessionSecret: clean(env.SESSION_SECRET),
    scopes: clean(env.OURA_SCOPES) ?? DEFAULT_SCOPES,
    tokenPath: expandHome(clean(env.OURA_TOKEN_PATH) ?? "~/.oura-mcp/tokens.json"),
    timezone: clean(env.OURA_TIMEZONE),
    apiBase: clean(env.OURA_API_BASE) ?? OURA_API_BASE,
  };
}

/** Today's date as YYYY-MM-DD in the configured timezone (or the system one). */
export function todayISO(timezone?: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

export function addDays(dateISO: string, delta: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Resolve a date window. Rules:
 *  - both given -> as is
 *  - only end   -> [end - (days-1), end]
 *  - only start -> [start, min(start + days - 1, today)]
 *  - none       -> [today - (days-1), today]
 */
export function resolveDateRange(
  opts: { start_date?: string; end_date?: string; days?: number },
  timezone?: string,
): { start_date: string; end_date: string } {
  const days = Math.max(1, Math.floor(opts.days ?? 7));
  const today = todayISO(timezone);
  for (const [k, v] of Object.entries({ start_date: opts.start_date, end_date: opts.end_date })) {
    if (v !== undefined && !isISODate(v)) {
      throw new Error(`${k} must be YYYY-MM-DD, got "${v}"`);
    }
  }
  let start = opts.start_date;
  let end = opts.end_date;
  if (start && end) {
    // fallthrough
  } else if (end) {
    start = addDays(end, -(days - 1));
  } else if (start) {
    end = addDays(start, days - 1);
    if (end > today) end = today;
    if (end < start) end = start;
  } else {
    end = today;
    start = addDays(end, -(days - 1));
  }
  if (start! > end!) throw new Error(`start_date (${start}) is after end_date (${end})`);
  return { start_date: start!, end_date: end! };
}

/** Resolve a datetime window for the heartrate endpoint (defaults to the last `hours`). */
export function resolveDateTimeRange(
  opts: { start_datetime?: string; end_datetime?: string; hours?: number },
  now: Date = new Date(),
): { start_datetime: string; end_datetime: string } {
  const hours = Math.max(1, opts.hours ?? 24);
  const parse = (label: string, v: string): Date => {
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) throw new Error(`${label} must be ISO 8601 datetime, got "${v}"`);
    return d;
  };
  let end = opts.end_datetime ? parse("end_datetime", opts.end_datetime) : undefined;
  let start = opts.start_datetime ? parse("start_datetime", opts.start_datetime) : undefined;
  if (!start && !end) {
    end = now;
    start = new Date(now.getTime() - hours * 3_600_000);
  } else if (!start) {
    start = new Date(end!.getTime() - hours * 3_600_000);
  } else if (!end) {
    end = new Date(Math.min(start.getTime() + hours * 3_600_000, now.getTime()));
    if (end < start) end = start;
  }
  if (start! > end!) throw new Error("start_datetime is after end_datetime");
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { start_datetime: iso(start!), end_datetime: iso(end!) };
}
