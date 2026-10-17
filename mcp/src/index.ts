#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PlinthClient } from "@plinth/sdk";
import { createServer } from "./server.js";

const { PLINTH_URL, PLINTH_TOKEN, PLINTH_EMAIL, PLINTH_PASSWORD, PLINTH_PANEL_URL } = process.env;
if (!PLINTH_URL) {
  console.error("PLINTH_URL is required (plus PLINTH_TOKEN, or PLINTH_EMAIL and PLINTH_PASSWORD)");
  process.exit(1);
}
const client = new PlinthClient({
  baseUrl: PLINTH_URL,
  ...(PLINTH_TOKEN ? { token: PLINTH_TOKEN } : PLINTH_EMAIL && PLINTH_PASSWORD ? { credentials: { email: PLINTH_EMAIL, password: PLINTH_PASSWORD } } : {}),
});
await createServer(client, { panelUrl: PLINTH_PANEL_URL }).connect(new StdioServerTransport());
