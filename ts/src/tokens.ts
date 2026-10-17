import type { Access } from "./types.js";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

export interface SigningKey {
  privateKey: CryptoKey;
  /** Raw 32-byte public key in standard base64, as `PUT /v1/auth/signing-key` expects. */
  publicKeyBase64: string;
}

/** Make an Ed25519 key pair with Web Crypto. */
export async function generateSigningKey(): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyBase64: b64(raw) };
}

export interface GrantTokenOptions {
  privateKey: CryptoKey;
  kid: string;
  tenant: string;
  issuer: string;
  subject: string;
  ttlSeconds: number;
  access: Access;
  /** Unix seconds; defaults to now. Mainly for tests. */
  now?: number;
}

/** Sign an EdDSA JWT in the shape of the server's `authorization.md`. Server side only. */
export async function signGrantToken(o: GrantTokenOptions): Promise<string> {
  const iat = o.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid: o.kid };
  const claims = {
    iss: o.issuer,
    sub: o.subject,
    iat,
    exp: iat + o.ttlSeconds,
    plinth: { tenant: o.tenant, access: o.access },
  };
  const input = `${json(header)}.${json(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", o.privateKey, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}
