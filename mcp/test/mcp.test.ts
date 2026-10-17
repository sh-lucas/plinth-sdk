import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PlinthClient } from "@plinth/sdk";
import { createServer } from "../src/server.js";
import { createFixture, createPointsModel, hasServer, isLocal, type Fixture } from "../../ts/test/fixture.js";

type Result = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as Result;
const out = (r: Result) => r.content[0]!.text;

const EXPECTED = [
  "overview", "get_template", "list_domains", "get_balances", "list_transactions", "get_transaction",
  "replay_transaction", "preview", "validate_proposal", "propose", "list_proposals", "get_proposal",
];

describe.skipIf(!hasServer)("mcp server against a server", () => {
  let fx: Fixture;
  let m: Awaited<ReturnType<typeof createPointsModel>>;
  let client: Client;
  let alice: string;

  beforeAll(async () => {
    fx = await createFixture();
    m = await createPointsModel(fx);
    alice = fx.id("alice");
    await fx.admin.buckets.create(m.domain, { id: alice });
    await fx.admin.execute(m.credit, { context: { bucket: alice }, inputs: { amount: 50 }, idempotencyKey: `mcp:${fx.runid}:credit` });

    const plinth = new PlinthClient({ baseUrl: fx.url, credentials: { email: fx.email, password: fx.password } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer(plinth, { panelUrl: "https://panel.example/" }).connect(b);
    client = new Client({ name: "test", version: "0" });
    await client.connect(a);
  });

  it("lists exactly the read, preview and propose tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([...EXPECTED].sort());
    const propose = (await client.listTools()).tools.find((t) => t.name === "propose")!;
    expect(propose.description).toContain("human approves");
    const res = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(res).toEqual(["plinth://docs/modelling", "plinth://docs/programs"]);
    const doc = await client.readResource({ uri: "plinth://docs/programs" });
    expect((doc.contents[0] as { text: string }).text).toContain("Node reference");
  });

  it("reads: overview, template, domains, balances, transactions, replay", async () => {
    const ov = out(await call(client, "overview"));
    expect(ov).toContain(m.domain);
    expect(ov).toContain(`${m.redeem} [${m.domain}]`);
    expect(ov).toContain("INSUFFICIENT_POINTS");

    expect(out(await call(client, "get_template", { id: m.redeem }))).toContain("flowchart");
    expect(out(await call(client, "list_domains", { q: fx.runid }))).toContain(m.domain);
    const bal = JSON.parse(out(await call(client, "get_balances", { targets: [{ bucket: alice }] })));
    expect(bal.items.map((i: { balance: number }) => i.balance)).toEqual([50]);

    const list = JSON.parse(out(await call(client, "list_transactions", { bucket: alice })));
    const id = list.items[0].id;
    expect(JSON.parse(out(await call(client, "get_transaction", { id }))).id).toBe(id);
    expect(JSON.parse(out(await call(client, "replay_transaction", { id }))).matches).toBe(true);
  });

  it("previews a published template and reports server errors as tool errors", async () => {
    const p = JSON.parse(out(await call(client, "preview", { template: m.redeem, context: { bucket: alice }, inputs: { amount: 20 } })));
    expect(p.postings).toEqual([{ bucket: alice, amount: -20 }]);
    const big = await call(client, "preview", { template: m.redeem, context: { bucket: alice }, inputs: { amount: 999 } });
    expect(big.isError).toBe(true);
    expect(JSON.parse(out(big))).toMatchObject({ status: 422, rejection: "INSUFFICIENT_POINTS" });
  });

  it.skipIf(!isLocal)("validates and creates a proposal (needs /v1/proposals on the server)", async (ctx) => {
    const domain = fx.id("mcp-prop");
    const body = {
      title: "Stamps", memo: "from mcp test",
      domains: [{ id: domain, kind: "points", unit: "stamp", parent: fx.org }],
      templates: [{
        id: fx.id("mcp-prop-add"), domain, name: "Add",
        nodes: [
          { id: "account", op: "bucket" },
          { id: "n", op: "input", value_type: "integer", min: 1 },
          { id: "p", op: "post", bucket: "account", amount: "n", direction: "in" },
        ],
      }],
    };
    const v = await call(client, "validate_proposal", body);
    if (v.isError && JSON.parse(out(v)).status === 404) return ctx.skip();
    expect(JSON.parse(out(v))).toEqual({ valid: true });
    const bad = await call(client, "validate_proposal", { ...body, domains: [{ ...body.domains[0], parent: "no-such-parent" }] });
    expect(bad.isError).toBe(true);

    const p = JSON.parse(out(await call(client, "propose", body)));
    expect(p.status).toBe("pending");
    expect(p.panel_link).toBe(`https://panel.example/proposals/${p.id}`);
    expect(JSON.parse(out(await call(client, "get_proposal", { id: p.id }))).title).toBe("Stamps");
    expect(out(await call(client, "list_proposals", { status: "pending" }))).toContain(p.id);
  });

  it("runs as a stdio process configured by env", async () => {
    execFileSync("pnpm", ["-C", "../ts", "build"], { stdio: "pipe" });
    execFileSync("pnpm", ["build"], { stdio: "pipe" });
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: { PATH: process.env.PATH!, PLINTH_URL: fx.url, PLINTH_EMAIL: fx.email, PLINTH_PASSWORD: fx.password },
    });
    const c = new Client({ name: "stdio", version: "0" });
    await c.connect(transport);
    expect((await c.listTools()).tools).toHaveLength(EXPECTED.length);
    expect(out(await call(c, "overview"))).toContain(m.domain);
    await c.close();
  });
});
