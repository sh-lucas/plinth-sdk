# Plinth SDKs

Client libraries and the MCP server for [Plinth](https://github.com/sh-lucas/plinth). The shared behaviour is in [`reference/contract.md`](reference/contract.md).

| Path | Contents |
| --- | --- |
| `ts/` | `@plinth/sdk`: TypeScript client and the `plinth gen` CLI |
| `mcp/` | `@plinth/mcp`: MCP server (stdio). It reads, previews, validates and proposes. It never executes |
| `examples/ts-wallet` | Node backend: loyalty points with `verify`, `execute` and rejections |
| `examples/ts-browser` | Backend mints a granular JWT, browser code uses it |
| `scripts/local-plinth.sh` | Disposable local server for the tests |

## Install

```sh
pnpm install
pnpm build
```

## Use (TypeScript)

```ts
import { PlinthClient, idempotencyKey, isRejection } from "@plinth/sdk";

const plinth = new PlinthClient({ baseUrl: "https://plinth.example", credentials: { email, password } });
await plinth.verify(["credit", "redeem"]); // at boot
try {
  const tx = await plinth.execute("redeem", {
    context: { bucket: "carol" }, inputs: { amount: 40 }, idempotencyKey: idempotencyKey("order", orderId, "redeem"),
  });
} catch (err) {
  if (!isRejection(err, "INSUFFICIENT_POINTS")) throw err;
}
console.log((await plinth.balances.bucket("carol")).balance);
```

## MCP server

Claude Code:

```sh
claude mcp add plinth -e PLINTH_URL=https://plinth.example -e PLINTH_EMAIL=you@example.com -e PLINTH_PASSWORD=... -- node /path/to/plinth-sdk/mcp/dist/index.js
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.plinth]
command = "node"
args = ["/path/to/plinth-sdk/mcp/dist/index.js"]
env = { PLINTH_URL = "https://plinth.example", PLINTH_EMAIL = "you@example.com", PLINTH_PASSWORD = "..." }
```

## Tests

Tests hit a real server. Start a disposable one, then run:

```sh
PLINTH_LOCAL_PORT=38181 scripts/local-plinth.sh start
source .e2e/38181/env
pnpm test
scripts/local-plinth.sh stop
```

Without `PLINTH_URL` the server tests are skipped. See "Test environment" in the contract.

## Java

`java/` holds `dev.shlucas.plinth:plinth-sdk` (Java 17+, Gradle, Jackson only). See [`java/README.md`](java/README.md). The runnable example and integration test is `examples/java-inventory/`.
