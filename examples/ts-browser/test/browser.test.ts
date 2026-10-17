import { describe, expect, it } from "vitest";
import { isNotFound } from "@plinth/sdk";
import { createFixture, createPointsModel, hasServer, isLocal } from "../../../ts/test/fixture.js";
import { registerSigningKey } from "../src/backend.js";
import { createBrowserApp } from "../src/browser.js";

// Rotates the tenant signing key, so it runs only against a disposable local server.
describe.skipIf(!hasServer || !isLocal)("ts-browser", () => {
  it("a granular token executes the granted template and gets 404 for another", async () => {
    const fx = await createFixture();
    const m = await createPointsModel(fx);
    const bucket = fx.id("dave");
    await fx.admin.buckets.create(m.domain, { id: bucket });

    const tenant = (await (await fetch(`${fx.url}/v1/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: fx.email, password: fx.password }),
    })).json() as { tenant: string }).tenant;
    const minter = await registerSigningKey({ url: fx.url, email: fx.email, password: fx.password, tenant, issuer: "example-backend", kid: `k-${fx.runid}` });

    const token = await minter.mint({ subject: "user-dave", templates: [m.credit], domains: [m.domain] });
    const app = createBrowserApp(fx.url, token);

    await app.credit(m.credit, bucket, 25, `c${fx.runid}1`);
    expect(await app.balance(bucket)).toBe(25);
    const denied = await app.credit(m.redeem, bucket, 5, `c${fx.runid}2`).catch((e) => e);
    expect(isNotFound(denied)).toBe(true);
  });
});
