#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, OURA_APPLICATIONS_URL } from "./config.js";
import { createTokenProvider, runAuthFlow, TokenStore } from "./auth.js";
import { OuraClient } from "./oura-client.js";
import { createOuraServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const USAGE = `${SERVER_NAME} ${SERVER_VERSION}

Usage:
  oura-mcp            start the MCP server on stdio (default)
  oura-mcp serve      same as above
  oura-mcp auth       run the OAuth2 flow and store tokens (needs OURA_CLIENT_ID / OURA_CLIENT_SECRET)
  oura-mcp status     show which credentials are in use and call /v2/usercollection/personal_info
  oura-mcp help       this text

Env: OURA_ACCESS_TOKEN | OURA_CLIENT_ID + OURA_CLIENT_SECRET (+ OURA_REDIRECT_URI, OURA_SCOPES, OURA_TOKEN_PATH), OURA_TIMEZONE
Create an OAuth app at ${OURA_APPLICATIONS_URL}
`;

async function serve(): Promise<void> {
  const config = loadConfig();
  const client = new OuraClient(createTokenProvider(config));
  const server = createOuraServer(client, { timezone: config.timezone });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[oura-mcp] ready (${client.auth.source})`);
}

async function auth(): Promise<void> {
  const config = loadConfig();
  const tokens = await runAuthFlow(config);
  const exp = tokens.expires_at ? new Date(tokens.expires_at * 1000).toISOString() : "unknown";
  console.error(`\nSaved tokens to ${config.tokenPath}`);
  console.error(`Scope: ${tokens.scope ?? "(not reported)"}; access token expires: ${exp}`);
  console.error(`Refresh token: ${tokens.refresh_token ? "yes (auto-refresh enabled)" : "no"}`);
}

async function status(): Promise<void> {
  const config = loadConfig();
  const provider = createTokenProvider(config);
  console.error(`Credentials: ${provider.source}`);
  if (!config.accessToken) {
    const stored = new TokenStore(config.tokenPath).read();
    if (!stored) {
      console.error(`No token file at ${config.tokenPath}. Run: oura-mcp auth`);
      process.exitCode = 1;
      return;
    }
    console.error(
      `Token file: scope=${stored.scope ?? "?"}, expires=${stored.expires_at ? new Date(stored.expires_at * 1000).toISOString() : "?"}, refresh_token=${stored.refresh_token ? "yes" : "no"}`,
    );
  }
  const client = new OuraClient(provider);
  const info = await client.get("/v2/usercollection/personal_info");
  console.log(JSON.stringify(info, null, 2));
}

const cmd = process.argv[2] ?? "serve";
const run: Record<string, () => Promise<void>> = { serve, auth, status };
if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.error(USAGE);
} else if (run[cmd]) {
  run[cmd]().catch((e: Error) => {
    console.error(`[oura-mcp] ${e.message}`);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
  process.exit(1);
}
