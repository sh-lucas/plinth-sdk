# @plinth/mcp

MCP server (stdio) for Plinth. It reads the ledger, previews published templates, validates proposals and creates proposals. It has no execute, approve or reject tool: a human approves in the panel.

## Configure

| Variable | Meaning |
| --- | --- |
| `PLINTH_URL` | Server origin (required). |
| `PLINTH_TOKEN` or `PLINTH_EMAIL` + `PLINTH_PASSWORD` | Credentials. |
| `PLINTH_PANEL_URL` | Panel origin. `propose` then returns `<panel>/proposals/<id>`. |

## Tools

`overview`, `get_template`, `list_domains`, `get_balances`, `list_transactions`, `get_transaction`, `replay_transaction`, `preview`, `validate_proposal`, `propose`, `list_proposals`, `get_proposal`.

Workflow: read `overview` and the docs, draft, `validate_proposal`, `propose`, then a human approves.

Resources: `plinth://docs/programs` (DSL reference), `plinth://docs/modelling`.

## Docs

`docs/` holds copies of `programs.md` and `modelling.md` from the server repo. Refresh them with `pnpm sync-docs` (reads `../../plinth/specs`, or `PLINTH_SPECS`).

## Tests

```sh
source ../.e2e/38181/env && pnpm test
```
