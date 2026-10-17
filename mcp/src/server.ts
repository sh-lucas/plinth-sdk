import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlinthError, type Domain, type PlinthClient, type ProposalInput, type Template } from "@plinth/sdk";

const WORKFLOW =
  "Workflow for new domains or templates: read `overview` and the docs resources (plinth://docs/programs, plinth://docs/modelling), draft, run `validate_proposal` until it passes, run `propose`, then a human approves it in the panel. This server cannot execute templates or approve proposals.";

const doc = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8");

const dump = (v: unknown) => JSON.stringify(v, null, 1);
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Run a tool body. A server error becomes a tool error the agent can read and fix. */
async function run(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (err) {
    if (err instanceof PlinthError) {
      const { status, code, message, rejection, node, operation } = err;
      return { ...text(dump({ status, code, message, rejection, node, operation })), isError: true };
    }
    return { ...text(err instanceof Error ? err.message : String(err)), isError: true };
  }
}

const context = z.union([z.object({ bucket: z.string() }), z.object({ domain: z.string() })]);
const page = { page: z.number().int().min(1).optional(), per_page: z.number().int().min(1).max(500).optional() };
const proposalShape = {
  title: z.string().describe("Short title shown to the approver."),
  memo: z.string().optional().describe("Why this change is needed."),
  domains: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string().describe("Free-form label, e.g. points, money, stock, group."),
        name: z.string().optional(),
        unit: z.string().optional().describe("Set it for a scalar domain (holds buckets). Omit it for an organizational domain."),
        parent: z.string().nullable().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
  templates: z
    .array(
      z.object({
        id: z.string().describe("Immutable. Publish a new id (e.g. redeem-v2) to change a rule."),
        domain: z.string().describe("May be a domain created by the same proposal."),
        name: z.string(),
        description: z.string().optional(),
        nodes: z.array(z.record(z.unknown())).describe("Program nodes, see plinth://docs/programs."),
      }),
    )
    .optional(),
};

function describeTemplate(t: Template): string {
  const inputs = t.nodes
    .filter((n) => n.op === "input")
    .map((n) => `${n.id}:${n.value_type}${n.min != null ? ` min ${n.min}` : ""}${n.max != null ? ` max ${n.max}` : ""}`);
  const guards = t.nodes.flatMap((n) => (n.op === "require" ? [n.code] : n.op === "allocate" && (n.require as { code?: string })?.code ? [(n.require as { code: string }).code] : []));
  return `- ${t.id} [${t.domain}]${t.disabled ? " DISABLED" : ""} "${t.name}" inputs(${inputs.join(", ")})${guards.length ? ` guards(${guards.join(", ")})` : ""}`;
}

function domainTree(domains: Domain[]): string {
  const kids = new Map<string, Domain[]>();
  const ids = new Set(domains.map((d) => d.id));
  for (const d of domains) {
    const key = d.parent && ids.has(d.parent) ? d.parent : "";
    kids.set(key, [...(kids.get(key) ?? []), d]);
  }
  const lines: string[] = [];
  const walk = (key: string, depth: number) => {
    for (const d of kids.get(key) ?? []) {
      lines.push(`${"  ".repeat(depth)}${d.id} (${d.unit ? `scalar, unit ${d.unit}` : "organizational"}, kind ${d.kind})`);
      walk(d.id, depth + 1);
    }
  };
  walk("", 0);
  return lines.join("\n");
}

export interface ServerOptions {
  /** Panel origin. When set, `propose` returns a link to the proposal. */
  panelUrl?: string;
}

export function createServer(client: PlinthClient, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "plinth", version: "0.1.0" });

  server.registerResource(
    "programs",
    "plinth://docs/programs",
    { title: "Plinth program DSL reference", mimeType: "text/markdown", description: "Complete node reference for template programs." },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: doc("programs.md") }] }),
  );
  server.registerResource(
    "modelling",
    "plinth://docs/modelling",
    { title: "Modelling a business on Plinth", mimeType: "text/markdown", description: "Domains, buckets, templates and how to shape them." },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: doc("modelling.md") }] }),
  );

  server.registerTool(
    "overview",
    {
      description: `Start here. Compact view of the domain tree and every template (inputs and guard codes). ${WORKFLOW}`,
      inputSchema: {},
    },
    () =>
      run(async () => {
        const domains: Domain[] = [];
        for await (const d of client.domains.listAll()) domains.push(d);
        const templates: Template[] = [];
        for await (const t of client.templates.listAll()) templates.push(t);
        return `Domains:\n${domainTree(domains) || "(none)"}\n\nTemplates:\n${templates.map(describeTemplate).join("\n") || "(none)"}`;
      }),
  );

  server.registerTool(
    "get_template",
    { description: "Nodes of one template plus its Mermaid flow diagram.", inputSchema: { id: z.string() } },
    ({ id }) =>
      run(async () => {
        const [t, diagram] = await Promise.all([client.templates.get(id), client.templates.diagram(id)]);
        return `${dump(t)}\n\nDiagram (Mermaid):\n${diagram}`;
      }),
  );

  server.registerTool(
    "list_domains",
    {
      description: "List domains. `q` searches by text. `parent` lists direct children.",
      inputSchema: { q: z.string().max(256).optional(), kind: z.string().optional(), parent: z.string().optional(), ...page },
    },
    ({ q, kind, parent, page, per_page }) => run(async () => dump(await client.domains.list({ q, kind, parent, page, perPage: per_page }))),
  );

  server.registerTool(
    "get_balances",
    {
      description: "Balances of up to 256 buckets or scalar domains in one call. Dates are YYYY-MM-DD, inclusive.",
      inputSchema: {
        targets: z.array(z.union([z.object({ bucket: z.string() }), z.object({ domain: z.string() })])).min(1).max(256),
        since: z.string().optional(),
        until: z.string().optional(),
      },
    },
    ({ targets, since, until }) => run(async () => dump(await client.balances.query(targets, { since, until }))),
  );

  server.registerTool(
    "list_transactions",
    {
      description: "List transactions, newest first. Filter by date window, template, bucket or domain.",
      inputSchema: {
        since: z.string().optional(),
        until: z.string().optional(),
        template: z.string().optional(),
        domain: z.string().optional(),
        bucket: z.string().optional(),
        ...page,
      },
    },
    ({ per_page, ...f }) => run(async () => dump(await client.transactions.list({ ...f, perPage: per_page }))),
  );

  server.registerTool(
    "get_transaction",
    { description: "One transaction with its postings.", inputSchema: { id: z.string() } },
    ({ id }) => run(async () => dump(await client.transactions.get(id))),
  );

  server.registerTool(
    "replay_transaction",
    {
      description: "Re-run a transaction's template against the ledger as it was, and show what each node saw. Writes nothing. Admin only.",
      inputSchema: { id: z.string() },
    },
    ({ id }) => run(async () => dump(await client.transactions.replay(id))),
  );

  server.registerTool(
    "preview",
    {
      description: "Dry-run a PUBLISHED template and show the postings it would write. Nothing is stored. To try a template that does not exist yet, use validate_proposal.",
      inputSchema: {
        template: z.string(),
        context: context.optional().describe('{"bucket": "id"} or {"domain": "id"}'),
        inputs: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
        effective_at: z.string().optional().describe("RFC 3339"),
      },
    },
    ({ template, context, inputs, effective_at }) =>
      run(async () => dump(await client.preview(template, { context, inputs, effectiveAt: effective_at }))),
  );

  server.registerTool(
    "validate_proposal",
    {
      description: `Dry run of a proposal: checks ids, parents and template programs and stores nothing. Repeat until it passes. ${WORKFLOW}`,
      inputSchema: proposalShape,
    },
    (body) => run(async () => dump(await client.proposals.validate(body as ProposalInput))),
  );

  server.registerTool(
    "propose",
    {
      description: `Create a pending proposal of new domains and templates. It changes nothing until a human approves it in the panel. Call validate_proposal first. ${WORKFLOW}`,
      inputSchema: proposalShape,
    },
    (body) =>
      run(async () => {
        const p = await client.proposals.create(body as ProposalInput);
        const link = opts.panelUrl ? `${opts.panelUrl.replace(/\/+$/, "")}/proposals/${p.id}` : undefined;
        return dump({ id: p.id, status: p.status, ...(link && { panel_link: link }), message: "Pending. A human must approve it in the panel." });
      }),
  );

  server.registerTool(
    "list_proposals",
    { description: "List proposals, newest first.", inputSchema: { status: z.enum(["pending", "approved", "rejected"]).optional(), ...page } },
    ({ status, page, per_page }) => run(async () => dump(await client.proposals.list({ status, page, perPage: per_page }))),
  );

  server.registerTool(
    "get_proposal",
    { description: "One proposal with its status and decision.", inputSchema: { id: z.string() } },
    ({ id }) => run(async () => dump(await client.proposals.get(id))),
  );

  return server;
}
