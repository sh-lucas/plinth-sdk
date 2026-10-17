// "Browser" code: it only receives a token. It never sees the private key or the admin password.
import { PlinthClient, idempotencyKey } from "@plinth/sdk";

export function createBrowserApp(baseUrl: string, token: string) {
  const client = new PlinthClient({ baseUrl, token });
  return {
    balance: async (bucket: string) => (await client.balances.bucket(bucket)).balance,
    credit: (template: string, bucket: string, amount: number, clickId: string) =>
      client.execute(template, { context: { bucket }, inputs: { amount }, idempotencyKey: idempotencyKey("click", clickId) }),
  };
}
