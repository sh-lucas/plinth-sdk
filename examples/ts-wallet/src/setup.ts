// Admin setup: run once per environment, not by the app. Domain, bucket and templates are idempotent by id (409 = exists).
import { isConflict, type PlinthClient } from "@plinth/sdk";

export interface WalletIds {
  /** Organizational parent domain that already exists. */
  parent: string;
  domain: string;
  credit: string;
  redeem: string;
}

const ignoreConflict = (p: Promise<unknown>) => p.catch((err) => { if (!isConflict(err)) throw err; });

export async function setupWallet(admin: PlinthClient, ids: WalletIds) {
  await ignoreConflict(admin.domains.create({ id: ids.domain, name: "Loyalty points", kind: "points", unit: "point", parent: ids.parent }));
  const account = { id: "account", op: "bucket" };
  const amount = { id: "amount", op: "input", value_type: "integer", min: 1 };
  await ignoreConflict(
    admin.templates.publish({
      id: ids.credit, domain: ids.domain, name: "Credit points",
      nodes: [account, amount, { id: "add", op: "post", bucket: "account", amount: "amount", direction: "in" }],
    }),
  );
  await ignoreConflict(
    admin.templates.publish({
      id: ids.redeem, domain: ids.domain, name: "Redeem points",
      nodes: [
        account, amount,
        { id: "available", op: "balance", scope: { bucket: "account" } },
        { id: "enough", op: "compare", operator: "gte", left: "available", right: "amount" },
        { id: "guard", op: "require", condition: "enough", code: "INSUFFICIENT_POINTS", message: "not enough points" },
        { id: "spend", op: "post", bucket: "account", amount: "amount", direction: "out" },
      ],
    }),
  );
}

/** One bucket per customer. */
export const openAccount = (admin: PlinthClient, ids: WalletIds, customer: string) =>
  ignoreConflict(admin.buckets.create(ids.domain, { id: customer }));
