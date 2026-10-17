// Application code: only executes existing templates. Idempotency keys come from business ids, never from randomness.
import { idempotencyKey, isRejection, type PlinthClient } from "@plinth/sdk";
import type { WalletIds } from "./setup.js";

export async function createWallet(client: PlinthClient, ids: WalletIds) {
  await client.verify([ids.credit, ids.redeem]); // fail at boot, not on the first request

  return {
    credit: (customer: string, orderId: string, points: number) =>
      client.execute(ids.credit, {
        context: { bucket: customer },
        inputs: { amount: points },
        idempotencyKey: idempotencyKey("order", orderId, "credit"),
      }),

    /** Returns `{ok:false}` instead of throwing when the customer has too few points. */
    async redeem(customer: string, orderId: string, points: number) {
      try {
        const tx = await client.execute(ids.redeem, {
          context: { bucket: customer },
          inputs: { amount: points },
          idempotencyKey: idempotencyKey("order", orderId, "redeem"),
        });
        return { ok: true as const, transactionId: tx.id };
      } catch (err) {
        if (isRejection(err, "INSUFFICIENT_POINTS")) return { ok: false as const, reason: "INSUFFICIENT_POINTS" as const };
        throw err;
      }
    },

    balance: async (customer: string) => (await client.balances.bucket(customer)).balance,
  };
}
