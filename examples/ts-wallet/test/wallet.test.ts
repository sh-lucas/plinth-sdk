import { beforeAll, describe, expect, it } from "vitest";
import { PlinthClient } from "@plinth/sdk";
import { createFixture, hasServer } from "../../../ts/test/fixture.js";
import { createWallet } from "../src/app.js";
import { openAccount, setupWallet, type WalletIds } from "../src/setup.js";

describe.skipIf(!hasServer)("ts-wallet", () => {
  it("credits, redeems, rejects overdraft and survives a retried execute", async () => {
    const fx = await createFixture();
    const ids: WalletIds = { parent: fx.org, domain: fx.id("points"), credit: fx.id("credit"), redeem: fx.id("redeem") };
    const customer = fx.id("carol");
    await setupWallet(fx.admin, ids);
    await openAccount(fx.admin, ids, customer);

    const app = await createWallet(new PlinthClient({ baseUrl: fx.url, credentials: { email: fx.email, password: fx.password } }), ids);
    const first = await app.credit(customer, `o-${fx.runid}-1`, 100);
    const retry = await app.credit(customer, `o-${fx.runid}-1`, 100); // same order: same key: same transaction
    expect(retry.id).toBe(first.id);
    expect(await app.balance(customer)).toBe(100);

    expect(await app.redeem(customer, `o-${fx.runid}-2`, 150)).toEqual({ ok: false, reason: "INSUFFICIENT_POINTS" });
    expect((await app.redeem(customer, `o-${fx.runid}-3`, 40)).ok).toBe(true);
    expect(await app.balance(customer)).toBe(60);
  });

  it("verify fails at boot for a missing template", async () => {
    const fx = await createFixture();
    const ids: WalletIds = { parent: fx.org, domain: fx.id("points"), credit: fx.id("credit"), redeem: fx.id("redeem") };
    await expect(createWallet(fx.admin, ids)).rejects.toThrow(/missing/);
  });
});
