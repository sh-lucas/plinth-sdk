# @plinth/sdk

TypeScript client for Plinth. No runtime dependencies: it needs only `fetch` and Web Crypto (Node 20+, Bun, Deno, browsers).

```ts
import { PlinthClient } from "@plinth/sdk";
const plinth = new PlinthClient({ baseUrl, token }); // or { baseUrl, credentials: { email, password } }
```

- Operations: `execute`, `preview`, `batch`, `batchPreview`, `verify`, `balances`, `transactions`, `templates`, `domains`, `buckets`, `proposals`. Listings return a page; `listAll` / `postingsAll` / `subtreeAll` iterate all pages.
- `execute` needs an `idempotencyKey`. Use `idempotencyKey("order", id, "redeem")`. Retries after a lost response return the original transaction.
- Inputs are checked against the template before the request (`validateInputs: false` disables it).
- Errors: `PlinthError` (`status`, `code`, `rejection`, `node`), `isRejection(err, code?)`, `isNotFound`, `isConflict`, `isUnauthorized`, `PlinthValidationError`, `PlinthVerifyError`.
- Tokens (server side only): `generateSigningKey()`, `signGrantToken({...})`.

## Generate typed wrappers

```sh
plinth gen --url https://plinth.example --email a@b.c --password ... --out plinth.gen.ts credit redeem
```

```ts
import { createTemplates } from "./plinth.gen.js";
const t = createTemplates(plinth);
await t.redeem.execute({ inputs: { amount: 5 }, context: { bucket: "carol" }, idempotencyKey: idempotencyKey("order", orderId, "redeem") });
```

The file holds an `Inputs` and a `Rejection` type per template. Keep it in version control: template ids are immutable.

## Tests

```sh
source ../.e2e/38181/env && pnpm test
```
