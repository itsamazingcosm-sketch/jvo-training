import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { OURA_AUTHORIZE_URL, OURA_TOKEN_URL, type OuraConfig } from "./config.js";

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  /** Unix seconds */
  expires_at?: number;
}

/** Anything the client can ask for a bearer token and, on 401, a refreshed one. */
export interface TokenProvider {
  /** Human-readable description of where the token comes from (for `status`). */
  readonly source: string;
  getAccessToken(): Promise<string>;
  /** Try to refresh; return the new token or null when refreshing is impossible. */
  refresh(): Promise<string | null>;
}

// ---------- token file ----------

export class TokenStore {
  constructor(readonly path: string) {}

  read(): StoredTokens | null {
    if (!existsSync(this.path)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as StoredTokens;
      return raw && typeof raw.access_token === "string" ? raw : null;
    } catch {
      return null;
    }
  }

  write(tokens: StoredTokens): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(tokens, null, 2) + "\n", { mode: 0o600 });
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* Windows */
    }
  }
}

// ---------- token endpoint ----------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

async function postToken(body: Record<string, string>, fetchFn: typeof fetch = fetch): Promise<StoredTokens> {
  const res = await fetchFn(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Oura token endpoint returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as TokenResponse;
  if (!data.access_token) throw new Error("Oura token endpoint returned no access_token");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    scope: data.scope,
    expires_at: typeof data.expires_in === "number" ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
  };
}

export async function exchangeCode(
  config: OuraConfig,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<StoredTokens> {
  if (!config.clientId || !config.clientSecret) throw new Error("OURA_CLIENT_ID / OURA_CLIENT_SECRET are required");
  return postToken(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
    fetchFn,
  );
}

export async function refreshTokens(
  config: OuraConfig,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<StoredTokens> {
  if (!config.clientId || !config.clientSecret) throw new Error("OURA_CLIENT_ID / OURA_CLIENT_SECRET are required");
  const fresh = await postToken(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
    fetchFn,
  );
  // Oura may omit refresh_token in a refresh response: keep the old one.
  return { ...fresh, refresh_token: fresh.refresh_token ?? refreshToken };
}

// ---------- providers ----------

/** A fixed token (PAT or a manually supplied OAuth access token), optionally refreshable. */
export class StaticTokenProvider implements TokenProvider {
  private token: string;
  private refreshToken?: string;
  private refreshing: Promise<string | null> | null = null;

  constructor(
    private readonly config: OuraConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    if (!config.accessToken) throw new Error("OURA_ACCESS_TOKEN is not set");
    this.token = config.accessToken;
    this.refreshToken = config.refreshToken;
  }

  get source(): string {
    return this.refreshToken && this.config.clientId && this.config.clientSecret
      ? "env: OURA_ACCESS_TOKEN + OURA_REFRESH_TOKEN (auto-refresh)"
      : "env: OURA_ACCESS_TOKEN (no refresh)";
  }

  async getAccessToken(): Promise<string> {
    return this.token;
  }

  async refresh(): Promise<string | null> {
    if (!this.refreshToken || !this.config.clientId || !this.config.clientSecret) return null;
    if (!this.refreshing) {
      this.refreshing = refreshTokens(this.config, this.refreshToken, this.fetchFn)
        .then((t) => {
          this.token = t.access_token;
          this.refreshToken = t.refresh_token;
          console.error("[oura-mcp] access token refreshed");
          return this.token;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }
}

/** Tokens persisted by `oura-mcp auth`, refreshed proactively before expiry and on 401. */
export class FileTokenProvider implements TokenProvider {
  private refreshing: Promise<string | null> | null = null;
  readonly store: TokenStore;

  constructor(
    private readonly config: OuraConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.store = new TokenStore(config.tokenPath);
  }

  get source(): string {
    return `file: ${this.config.tokenPath}`;
  }

  async getAccessToken(): Promise<string> {
    const tokens = this.store.read();
    if (!tokens) {
      throw new Error(
        `No Oura tokens at ${this.config.tokenPath}. Run "oura-mcp auth" (npm run auth) or set OURA_ACCESS_TOKEN.`,
      );
    }
    const soon = Math.floor(this.now() / 1000) + 5 * 60;
    if (tokens.refresh_token && tokens.expires_at && tokens.expires_at < soon) {
      const refreshed = await this.refresh();
      if (refreshed) return refreshed;
    }
    return tokens.access_token;
  }

  async refresh(): Promise<string | null> {
    const tokens = this.store.read();
    if (!tokens?.refresh_token) return null;
    if (!this.refreshing) {
      this.refreshing = refreshTokens(this.config, tokens.refresh_token, this.fetchFn)
        .then((fresh) => {
          const merged: StoredTokens = { ...tokens, ...fresh, scope: fresh.scope ?? tokens.scope };
          this.store.write(merged);
          console.error("[oura-mcp] access token refreshed");
          return merged.access_token;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }
}

/** Pick a provider from the environment: explicit token first, then the token file. */
export function createTokenProvider(config: OuraConfig, fetchFn: typeof fetch = fetch): TokenProvider {
  if (config.accessToken) return new StaticTokenProvider(config, fetchFn);
  return new FileTokenProvider(config, fetchFn);
}

// ---------- interactive OAuth2 flow ----------

export function buildAuthorizeUrl(config: OuraConfig, state: string): string {
  if (!config.clientId) throw new Error("OURA_CLIENT_ID is not set");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
  });
  return `${OURA_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Runs the authorization-code flow: starts a one-shot HTTP listener on the redirect URI,
 * prints the consent URL, waits for the callback, exchanges the code and stores the tokens.
 */
export async function runAuthFlow(config: OuraConfig, opts: { timeoutMs?: number } = {}): Promise<StoredTokens> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "OURA_CLIENT_ID and OURA_CLIENT_SECRET are required. Create an app at https://cloud.ouraring.com/oauth/applications",
    );
  }
  const redirect = new URL(config.redirectUri);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname)) {
    throw new Error(`OURA_REDIRECT_URI must point to localhost for the built-in flow, got ${config.redirectUri}`);
  }
  const port = Number(redirect.port || 80);
  const state = randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state);

  return new Promise<StoredTokens>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${redirect.host}`);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end("Not found");
        return;
      }
      const finish = (status: number, html: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);
      };
      if (url.searchParams.get("state") !== state) {
        finish(400, "<h2>Invalid state parameter</h2>");
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        finish(400, `<h2>Authorization failed: ${error}</h2>`);
        cleanup();
        reject(new Error(`Oura authorization failed: ${error}`));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        finish(400, "<h2>No authorization code in callback</h2>");
        return;
      }
      try {
        const tokens = await exchangeCode(config, code);
        if (!tokens.scope) tokens.scope = url.searchParams.get("scope") ?? undefined;
        new TokenStore(config.tokenPath).write(tokens);
        finish(200, "<h2>Oura MCP authorized ✔</h2><p>You can close this tab.</p>");
        cleanup();
        resolve(tokens);
      } catch (e) {
        finish(500, `<h2>Token exchange failed</h2><pre>${(e as Error).message}</pre>`);
        cleanup();
        reject(e);
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the OAuth callback"));
    }, opts.timeoutMs ?? 5 * 60_000);

    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };

    server.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.listen(port, redirect.hostname === "[::1]" ? "::1" : redirect.hostname, () => {
      console.error(`\nOpen this URL in your browser and approve access:\n\n${authorizeUrl}\n`);
      console.error(`Waiting for the callback on ${config.redirectUri} ...`);
    });
  });
}
