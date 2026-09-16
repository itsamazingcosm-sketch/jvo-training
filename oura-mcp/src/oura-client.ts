import { OURA_API_BASE } from "./config.js";
import type { TokenProvider } from "./auth.js";

export type Json = Record<string, unknown>;

export interface ListResult<T = Json> {
  data: T[];
  /** Cursor to continue from when `pages` was exhausted before the window was. */
  next_token?: string;
  pages_fetched: number;
}

export interface OuraClientOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  /** Max attempts for 429/5xx/network errors. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export class OuraApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`Oura API HTTP ${status} for ${url}: ${body.slice(0, 500)}`);
    this.name = "OuraApiError";
  }
}

/** Thin client for https://api.ouraring.com/v2 with retry, token refresh and cursor pagination. */
export class OuraClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly auth: TokenProvider,
    opts: OuraClientOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.baseUrl = opts.baseUrl ?? OURA_API_BASE;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** GET a JSON document from a v2 path (e.g. `/v2/usercollection/personal_info`). */
  async get<T = Json>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    let token = await this.auth.getAccessToken();
    let refreshed = false;

    for (let attempt = 1; ; attempt++) {
      let res: Response | undefined;
      let netErr: unknown;
      try {
        res = await this.fetchFn(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        netErr = e;
      }

      if (res?.status === 401 && !refreshed) {
        refreshed = true;
        const fresh = await this.auth.refresh().catch((e: Error) => {
          console.error(`[oura-mcp] token refresh failed: ${e.message}`);
          return null;
        });
        if (fresh) {
          token = fresh;
          continue;
        }
      }

      if (res && !RETRYABLE.has(res.status)) {
        const text = await res.text();
        if (!res.ok) throw new OuraApiError(res.status, url.pathname, text);
        return (text ? JSON.parse(text) : {}) as T;
      }

      if (attempt >= this.maxAttempts) {
        if (res) throw new OuraApiError(res.status, url.pathname, await res.text());
        throw netErr instanceof Error ? netErr : new Error(String(netErr));
      }
      const retryAfter = Number(res?.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
      console.error(`[oura-mcp] retry ${attempt}/${this.maxAttempts} in ${delay}ms (${res ? `HTTP ${res.status}` : "network error"})`);
      await this.sleep(Math.min(delay, 30_000));
    }
  }

  /**
   * Read a `/v2/usercollection/<collection>` list, following `next_token` up to `maxPages` pages.
   * Oura returns records oldest-first.
   */
  async list<T = Json>(
    collection: string,
    params: Record<string, string | number | undefined>,
    opts: { maxPages?: number; nextToken?: string } = {},
  ): Promise<ListResult<T>> {
    const maxPages = Math.max(1, opts.maxPages ?? 10);
    const data: T[] = [];
    let nextToken = opts.nextToken;
    let pages = 0;
    do {
      const page = await this.get<{ data?: T[]; next_token?: string | null }>(
        `/v2/usercollection/${collection}`,
        { ...params, next_token: nextToken },
      );
      data.push(...(page.data ?? []));
      nextToken = page.next_token ?? undefined;
      pages++;
    } while (nextToken && pages < maxPages);
    return { data, next_token: nextToken, pages_fetched: pages };
  }

  async listByDate<T = Json>(
    collection: string,
    range: { start_date: string; end_date: string },
    opts?: { maxPages?: number; nextToken?: string },
  ): Promise<ListResult<T>> {
    return this.list<T>(collection, range, opts);
  }

  async listByDateTime<T = Json>(
    collection: string,
    range: { start_datetime: string; end_datetime: string },
    opts?: { maxPages?: number; nextToken?: string },
  ): Promise<ListResult<T>> {
    return this.list<T>(collection, range, opts);
  }
}

/** Keys that hold dense time series (5-min / 30-sec samples). Dropped unless the caller asks for them. */
export const SERIES_KEYS = new Set([
  "heart_rate",
  "hrv",
  "met",
  "motion_count",
  "movement_30_sec",
  "sleep_phase_5_min",
  "class_5_min",
  "readiness_score_delta",
]);

export function stripSeries<T extends Json>(record: T): T {
  const out: Json = {};
  for (const [k, v] of Object.entries(record)) {
    if (SERIES_KEYS.has(k)) {
      if (v && typeof v === "object" && Array.isArray((v as Json).items)) {
        const items = (v as Json).items as unknown[];
        out[k] = { omitted: true, samples: items.length, interval: (v as Json).interval, hint: "pass include_series=true" };
      } else if (typeof v === "string") {
        out[k] = { omitted: true, length: v.length, hint: "pass include_series=true" };
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
