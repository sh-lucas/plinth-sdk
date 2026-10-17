// Backend: holds the private key and mints short-lived, granular tokens. Never ship this to the browser.
import { generateSigningKey, signGrantToken } from "@plinth/sdk";

export interface Minter {
  mint(grant: { templates: string[]; domains: string[]; subject: string; ttlSeconds?: number }): Promise<string>;
}

/** Register a fresh signing key with the tenant (admin; rotates the key) and return a minter. */
export async function registerSigningKey(
  o: { url: string; email: string; password: string; tenant: string; issuer: string; kid: string },
): Promise<Minter> {
  const { privateKey, publicKeyBase64 } = await generateSigningKey();
  const json = { "Content-Type": "application/json" };
  const login = await fetch(`${o.url}/v1/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email: o.email, password: o.password }) });
  const { token } = (await login.json()) as { token: string };
  const put = await fetch(`${o.url}/v1/auth/signing-key`, {
    method: "PUT",
    headers: { ...json, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kid: o.kid, public_key: publicKeyBase64 }),
  });
  if (!put.ok) throw new Error(`register signing key: ${put.status}`);
  return {
    mint: (g) =>
      signGrantToken({
        privateKey, kid: o.kid, tenant: o.tenant, issuer: o.issuer, subject: g.subject, ttlSeconds: g.ttlSeconds ?? 300,
        access: { templates: g.templates, domains: g.domains },
      }),
  };
}
