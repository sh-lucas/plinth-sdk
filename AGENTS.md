# Agent guidelines

Client libraries and the MCP server for [Plinth](https://github.com/sh-lucas/plinth). Simple, predictable code (KISS, YAGNI). No layers that the server does not need.

- [`reference/contract.md`](reference/contract.md): behaviour every SDK and the MCP server share. Read it first. Change it in the same change as the code.
- The server API reference is the running server: `/v1/openapi.json`, and the product book in the server repo (`specs/`).

## Layout

| Path | Contents |
| --- | --- |
| `ts/` | `@plinth/sdk`: TypeScript client (Node, Bun, Deno, browser) and the `plinth` CLI (`gen`) |
| `mcp/` | `@plinth/mcp`: MCP server (stdio), built on `ts/` |
| `java/` | `dev.shlucas.plinth:plinth-sdk`: Java 17+ client (Gradle) |
| `examples/` | Runnable integrations. Each one is also an integration test |
| `scripts/local-plinth.sh` | Disposable local server for the tests |

## Rules

1. Do not commit unless the user asks. Commit format: `chore/feat/fix: short sentence`.
2. Tests hit a real server. Prefer one deep integration test over many shallow mocked ones. Follow the test environment rules in the contract: never write outside the test root, never rotate signing keys or create users on a non-local server.
3. Zero runtime dependencies in `ts/` (only `fetch` and Web Crypto). `java/` depends on Jackson only. `mcp/` may depend on the official MCP SDK and `zod`.
4. Docs are short. Markdown files have no manual line breaks inside paragraphs.
5. The MCP server never executes templates. It reads, previews, validates and proposes.
