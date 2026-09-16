import type { TokenProvider } from "../src/auth.js";

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fetch stub that dispatches on pathname and records every call. */
export function mockFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, init });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    return route(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

export class FakeAuth implements TokenProvider {
  source = "fake";
  refreshCalls = 0;
  constructor(
    public token = "token-1",
    private readonly next: string | null = "token-2",
  ) {}
  async getAccessToken() {
    return this.token;
  }
  async refresh() {
    this.refreshCalls++;
    if (this.next) this.token = this.next;
    return this.next;
  }
}

/** Build a day list [start, end] inclusive. */
export function days(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
