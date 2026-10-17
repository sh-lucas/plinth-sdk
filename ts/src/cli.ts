#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { PlinthClient } from "./client.js";
import { generate } from "./gen.js";

const usage = `Usage: plinth gen --url <url> [--token <t> | --email <e> --password <p>] [--out plinth.gen.ts] <template ids...>
Env fallbacks: PLINTH_URL, PLINTH_TOKEN, PLINTH_EMAIL, PLINTH_PASSWORD.`;

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  if (cmd !== "gen") {
    console.error(usage);
    return cmd === "--help" || cmd === "-h" ? 0 : 1;
  }
  const flags: Record<string, string> = {};
  const ids: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) flags[a.slice(2)] = rest[++i] ?? "";
    else ids.push(a);
  }
  const url = flags.url ?? process.env.PLINTH_URL;
  const token = flags.token ?? process.env.PLINTH_TOKEN;
  const email = flags.email ?? process.env.PLINTH_EMAIL;
  const password = flags.password ?? process.env.PLINTH_PASSWORD;
  if (!url || !ids.length) {
    console.error(usage);
    return 1;
  }
  const client = new PlinthClient({
    baseUrl: url,
    ...(token ? { token } : email && password ? { credentials: { email, password } } : {}),
  });
  const templates = await Promise.all(ids.map((id) => client.templates.get(id)));
  const out = flags.out ?? "plinth.gen.ts";
  await writeFile(out, generate(templates, flags.sdk));
  console.log(`wrote ${out} (${ids.length} templates)`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
