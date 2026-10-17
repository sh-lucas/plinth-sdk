import { beforeAll, describe, expect, it } from "vitest";
import {
  PlinthClient, PlinthError, PlinthValidationError, PlinthVerifyError, idempotencyKey, isNotFound, isRejection,
} from "../src/index.js";
import { createFixture, createPointsModel, hasServer, isLocal, type Fixture } from "./fixture.js";

describe.skipIf(!hasServer)("sdk against a server", () => {
  let fx: Fixture;
  let m: Awaited<ReturnType<typeof createPointsModel>>;
  let calls: string[];
  let client: PlinthClient;

  beforeAll(async () => {
    fx = await createFixture();
    m = await createPointsModel(fx);
    await fx.admin.buckets.create(m.domain, { id: fx.id("alice") });
    calls = [];
    client = new PlinthClient({
      baseUrl: fx.url,
      credentials: { email: fx.email, password: fx.password },
      fetch: (async (url: string, init: RequestInit) => (calls.push(`${init.method} ${url}`), fetch(url, init))) as typeof fetch,
    });
  });

  it("verify lists missing and disabled templates", async () => {
    await client.verify([m.credit, m.redeem]);
    const err = await client.verify([m.credit, fx.id("nope")]).catch((e) => e);
    expect(err).toBeInstanceOf(PlinthVerifyError);
    expect(err.missing).toEqual([fx.id("nope")]);
  });

  it("executes, replays the same idempotency key and guards the balance", async () => {
    const alice = fx.id("alice");
    const key = idempotencyKey("sdk", fx.runid, "credit");
    const a = await client.execute(m.credit, { context: { bucket: alice }, inputs: { amount: 100 }, idempotencyKey: key });
    const b = await client.execute(m.credit, { context: { bucket: alice }, inputs: { amount: 100 }, idempotencyKey: key });
    expect(b.id).toBe(a.id);
    expect(a.postings).toMatchObject([{ bucket: alice, amount: 100 }]);

    const err = await client
      .execute(m.redeem, { context: { bucket: alice }, inputs: { amount: 500n }, idempotencyKey: idempotencyKey("sdk", fx.runid, "big") })
      .catch((e) => e);
    expect(isRejection(err, "INSUFFICIENT_POINTS")).toBe(true);
    expect(err).toMatchObject({ status: 422, node: "guard" });

    const ok = await client.execute(m.redeem, { context: { bucket: alice }, inputs: { amount: 30 }, idempotencyKey: idempotencyKey("sdk", fx.runid, "r1") });
    expect(ok.postings[0]!.amount).toBe(-30);

    expect((await client.balances.bucket(alice)).balance).toBe(70);
    expect((await client.balances.domain(m.domain)).balance).toBe(70);
    const q = await client.balances.query([{ bucket: alice }]);
    expect(q.items[0]!.balance).toBe(70);
    expect(q.consolidated).toEqual([{ unit: "point", balance: 70 }]);
  });

  it("validates inputs locally and caches the template", async () => {
    const before = calls.length;
    const err = await client.preview(m.redeem, { context: { bucket: fx.id("alice") }, inputs: { amount: 0, extra: 1 } }).catch((e) => e);
    expect(err).toBeInstanceOf(PlinthValidationError);
    expect(err.problems).toHaveLength(2);
    expect(calls.slice(before).filter((c) => c.includes("/preview/"))).toHaveLength(0);
    const p = await client.preview(m.redeem, { context: { bucket: fx.id("alice") }, inputs: { amount: 10 } });
    expect(p.postings).toEqual([{ bucket: fx.id("alice"), amount: -10 }]);
    expect(calls.slice(before).filter((c) => c.endsWith(`/templates/${m.redeem}`))).toHaveLength(0); // cached by the earlier execute
  });

  it("reads transactions, templates, domains, buckets and paginates", async () => {
    const alice = fx.id("alice");
    const all: string[] = [];
    for await (const t of client.transactions.listAll({ bucket: alice, perPage: 1 })) all.push(t.id);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const first = await client.transactions.list({ bucket: alice, perPage: 1 });
    expect(first.pagination).toMatchObject({ per_page: 1, has_next: true });
    const byKey = await client.transactions.byIdempotencyKey(idempotencyKey("sdk", fx.runid, "credit"));
    expect((await client.transactions.get(byKey.id)).id).toBe(byKey.id);
    expect((await client.transactions.replay(byKey.id)).matches).toBe(true);

    expect(await client.templates.diagram(m.redeem)).toContain("flowchart");
    expect((await client.templates.get(m.redeem)).nodes.length).toBeGreaterThan(3);
    expect((await client.templates.list({ domain: m.domain })).items.length).toBe(2);
    expect((await client.domains.children(fx.org)).items.map((d) => d.id)).toContain(m.domain);
    expect((await client.domains.subtree(fx.org)).items.length).toBeGreaterThanOrEqual(2);
    expect((await client.domains.list({ q: fx.runid })).items.length).toBeGreaterThanOrEqual(2);
    expect((await client.domains.buckets(m.domain)).items.map((b) => b.id)).toEqual([alice]);
    expect((await client.buckets.get(alice)).domain).toBe(m.domain);
    expect((await client.buckets.postings(alice)).items.length).toBeGreaterThanOrEqual(2);
    expect(isNotFound(await client.buckets.get(fx.id("zzz")).catch((e) => e))).toBe(true);
  });

  it("batch and batchPreview", async () => {
    const alice = fx.id("alice");
    const ops = [
      { template: m.credit, context: { bucket: alice }, inputs: { amount: 1 } },
      { template: m.credit, context: { bucket: alice }, inputs: { amount: 2 } },
    ];
    expect((await client.batchPreview(ops)).operations).toHaveLength(2);
    const txs = await client.batch(ops, { idempotencyKey: idempotencyKey("sdk", fx.runid, "batch") });
    expect(txs).toHaveLength(2);
  });

  it("errors carry the envelope", async () => {
    const err = await client.templates.get(fx.id("missing")).catch((e) => e);
    expect(err).toBeInstanceOf(PlinthError);
    expect(err).toMatchObject({ status: 404, code: "not_found" });
  });
});

describe.skipIf(!hasServer || !isLocal)("proposals (needs a local server with /v1/proposals)", () => {
  let fx: Fixture;
  let available = false;

  beforeAll(async () => {
    fx = await createFixture();
    available = await fx.admin.proposals.list().then(() => true, () => false);
  });

  it("validates, creates, lists, approves and rejects", async (ctx) => {
    if (!available) return ctx.skip();
    const domain = fx.id("prop-points");
    const body = {
      title: "Points",
      memo: "from sdk test",
      domains: [{ id: domain, name: "Points", kind: "points", unit: "point", parent: fx.org }],
      templates: [{
        id: fx.id("prop-credit"), domain, name: "Credit",
        nodes: [
          { id: "account", op: "bucket" },
          { id: "amount", op: "input", value_type: "integer", min: 1 },
          { id: "move", op: "post", bucket: "account", amount: "amount", direction: "in" },
        ],
      }],
    };
    expect(await fx.admin.proposals.validate(body)).toEqual({ valid: true });
    const p = await fx.admin.proposals.create(body);
    expect(p.status).toBe("pending");
    expect((await fx.admin.proposals.get(p.id)).title).toBe("Points");
    expect((await fx.admin.proposals.list({ status: "pending" })).items.map((x) => x.id)).toContain(p.id);
    expect((await fx.admin.proposals.approve(p.id, { memo: "ok" })).status).toBe("approved");
    await fx.admin.verify([fx.id("prop-credit")]);
    const again = await fx.admin.proposals.approve(p.id).catch((e) => e);
    expect(again).toMatchObject({ status: 409 });

    const r = await fx.admin.proposals.create({ title: "Nope", domains: [{ id: fx.id("prop-other"), kind: "group", parent: fx.org }] });
    expect((await fx.admin.proposals.reject(r.id, { memo: "no" })).status).toBe("rejected");
  });
});
