import { describe, expect, it } from "vitest";
import {
  PlinthClient, PlinthError, PlinthValidationError, generateSigningKey, idempotencyKey, isRejection, signGrantToken, checkInputs,
  type Template,
} from "../src/index.js";

const tpl: Template = {
  id: "t", domain: "d", name: "t", disabled: false, created_at: "",
  nodes: [
    { id: "amount", op: "input", value_type: "integer", min: 1, max: 100 },
    { id: "to", op: "input", value_type: "bucket" },
  ],
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("helpers", () => {
  it("idempotencyKey joins non-empty parts", () => {
    expect(idempotencyKey("order", 7, "", null, "redeem")).toBe("order:7:redeem");
  });
  it("isRejection matches 422 rejected and the guard code", () => {
    const e = new PlinthError(422, "rejected", "m", "NOPE", "guard");
    expect(isRejection(e)).toBe(true);
    expect(isRejection(e, "NOPE")).toBe(true);
    expect(isRejection(e, "OTHER")).toBe(false);
    expect(isRejection(new PlinthError(409, "conflict", "m"))).toBe(false);
  });
  it("checkInputs lists every problem", () => {
    expect(checkInputs(tpl, { amount: 0, to: "Bad Id", extra: 1 })).toHaveLength(4 - 1 + 0); // below min, bad ref, unknown
    expect(checkInputs(tpl, { amount: 5n, to: "alice" })).toEqual([]);
    expect(checkInputs(tpl, { amount: 1.5 })).toHaveLength(2); // not integer, missing to
    expect(checkInputs(tpl, { amount: 101, to: "a" })).toHaveLength(1);
  });
});

describe("tokens", () => {
  it("signs a JWT that the public key verifies", async () => {
    const { privateKey, publicKeyBase64 } = await generateSigningKey();
    const jwt = await signGrantToken({
      privateKey, kid: "k1", tenant: "acme", issuer: "iss", subject: "sub", ttlSeconds: 60, now: 1000,
      access: { templates: ["a"], domains: ["d"] },
    });
    const [h, c, s] = jwt.split(".") as [string, string, string];
    const dec = (x: string) => JSON.parse(Buffer.from(x, "base64url").toString());
    expect(dec(h)).toEqual({ alg: "EdDSA", typ: "JWT", kid: "k1" });
    expect(dec(c)).toEqual({ iss: "iss", sub: "sub", iat: 1000, exp: 1060, plinth: { tenant: "acme", access: { templates: ["a"], domains: ["d"] } } });
    const pub = await crypto.subtle.importKey("raw", Buffer.from(publicKeyBase64, "base64"), "Ed25519", false, ["verify"]);
    expect(Buffer.from(publicKeyBase64, "base64")).toHaveLength(32);
    expect(await crypto.subtle.verify("Ed25519", pub, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
});

describe("retries (fake fetch)", () => {
  const calls = () => {
    const log: { url: string; method: string }[] = [];
    return log;
  };

  it("retries reads on 503 and execute with replay_on_conflict", async () => {
    const log = calls();
    const responses = [json(503, { code: "unavailable", message: "x" }), json(200, { id: "tx" })];
    const fetch = (async (url: string, init: RequestInit) => {
      log.push({ url, method: init.method! });
      return responses.shift() ?? json(200, { id: "tx" });
    }) as typeof globalThis.fetch;
    const c = new PlinthClient({ baseUrl: "http://x", fetch, validateInputs: false });
    expect(await c.transactions.get("tx")).toEqual({ id: "tx" });
    expect(log).toHaveLength(2);
    responses.push(json(502, { code: "unavailable", message: "x" }), json(201, { id: "tx2" }));
    await c.execute("t", { inputs: {}, idempotencyKey: "k" });
    expect(log.slice(2).every((l) => l.url.includes("replay_on_conflict=true"))).toBe(true);
    expect(log).toHaveLength(4);
  });

  it("does not retry creation", async () => {
    let n = 0;
    const fetch = (async () => (n++, json(503, { code: "unavailable", message: "x" }))) as unknown as typeof globalThis.fetch;
    const c = new PlinthClient({ baseUrl: "http://x", fetch });
    await expect(c.domains.create({ id: "a", kind: "k" })).rejects.toBeInstanceOf(PlinthError);
    await expect(c.batch([], { idempotencyKey: "k" })).rejects.toBeInstanceOf(PlinthError);
    expect(n).toBe(2);
  });

  it("logs in lazily and once more after a 401", async () => {
    const seen: string[] = [];
    let logins = 0;
    const fetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/login")) return json(200, { token: `t${++logins}` });
      const auth = (init.headers as Record<string, string>).Authorization!;
      seen.push(auth);
      return auth === "Bearer t1" ? json(401, { code: "unauthorized", message: "x" }) : json(200, { id: "d", kind: "k", created_at: "" });
    }) as unknown as typeof globalThis.fetch;
    const c = new PlinthClient({ baseUrl: "http://x", credentials: { email: "a", password: "b" }, fetch });
    await c.domains.get("d");
    expect(seen).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("rejects token with credentials, and invalid inputs without a request", async () => {
    expect(() => new PlinthClient({ baseUrl: "http://x", token: "a", credentials: { email: "a", password: "b" } })).toThrow();
    let n = 0;
    const fetch = (async (url: string) => {
      n++;
      return url.includes("/templates/") ? json(200, tpl) : json(500, {});
    }) as unknown as typeof globalThis.fetch;
    const c = new PlinthClient({ baseUrl: "http://x", fetch });
    await expect(c.preview("t", { inputs: { amount: 0 } })).rejects.toBeInstanceOf(PlinthValidationError);
    await expect(c.preview("t", { inputs: {} })).rejects.toBeInstanceOf(PlinthValidationError);
    expect(n).toBe(1); // template fetched once, cached; no preview request
  });
});
