# Contract

Shared behaviour of every Plinth SDK in this repository (TypeScript, Java). When a language SDK and this file disagree, this file wins; fix the SDK or update this file in the same change.

## Principles

- The Plinth server is the source of truth. There is no local manifest: SDKs read templates from the server.
- Runtime code executes only templates that already exist and are enabled. Creating domains and templates is an admin task, or a **proposal** that an admin approves.
- A template id is immutable, so anything derived from it (cached definitions, generated types) never goes stale.
- No hidden magic: no random idempotency keys, no silent retries of non-idempotent calls.

## Client

| Option | Meaning |
| --- | --- |
| `baseUrl` | Server origin, e.g. `https://plinth.sh-lucas.dev`. The SDK adds `/v1`. |
| `token` | A bearer token (session token or bring-your-own-auth JWT). |
| `credentials` | `{email, password}`. The SDK logs in lazily and logs in again once on a `401`. Mutually exclusive with `token`. |
| `retries` | Retry budget for safe retries (default 2). |

Neither `token` nor `credentials` is valid: requests go without `Authorization` (local `DEFAULT_TENANT` servers).

## Operations

Names are the TypeScript ones; Java uses the same names in its own idiom.

- `execute(template, {context?, inputs?, effectiveAt?, metadata?, memo?, idempotencyKey})` → `Transaction`. `idempotencyKey` is required. Body fields map to the REST body (`effective_at`, etc.).
- `preview(template, {context?, inputs?, effectiveAt?, metadata?})` → `Preview` (`{postings, provisions}`, as the server answers).
- `batch(operations, {idempotencyKey})` and `batchPreview(operations)`.
- `balances.bucket(id, {since?, until?})`, `balances.domain(id, ...)`, `balances.query(targets, {since?, until?})`.
- `transactions.list(filters)`, `transactions.get(id)`, `transactions.byIdempotencyKey(key)`.
- `templates.list()`, `templates.get(id)`, `templates.diagram(id)`.
- `domains.list/get/children/subtree/buckets`, `buckets.get/postings`.
- Admin: `domains.create`, `buckets.create`, `templates.publish`, `templates.setDisabled`.
- Proposals: `proposals.create(body)`, `proposals.validate(body)` (dry run), `proposals.list({status?})`, `proposals.get(id)`, `proposals.approve(id, {memo?})`, `proposals.reject(id, {memo?})`.
- `verify(templateIds)`: fetch each template and fail with one error that lists every missing or disabled template. Call it at boot.

Paginated listings return `{items, pagination: {page, per_page, total, has_next, has_previous}}`; the SDKs expose that page and an async iterator (TS) / `Stream` or iterator (Java) over all pages.

## Input validation

Before `execute` or `preview`, the SDK fetches the template once (cached per client, since ids are immutable) and checks the caller's `inputs` against the `input` nodes:

- every input node must be present, and no unknown key is allowed;
- `integer`: a safe integer (TS: `number` with `Number.isSafeInteger`, or `bigint`), inside `min`/`max` when set;
- `bucket` and `reference`: a non-empty string matching `^[a-z0-9][a-z0-9._-]{0,63}$`.

A failure throws a `PlinthValidationError` that lists every problem, without a request. `validateInputs: false` on the client disables it.

## Errors

Every non-2xx response becomes a `PlinthError` with `status`, `code`, `message` and, when present, `rejection`, `node` and `operation` (the server's error envelope: `{"code","message","rejection"?,"node"?,"operation"?}`). Helpers:

- `isRejection(err, code?)`: a `422` with `code == "rejected"`, optionally with that guard code.
- `isNotFound`, `isConflict`, `isUnauthorized`.

## Retries and idempotency

- Reads (`GET`, `QUERY`, previews, `validate`): retried on network errors, `502`, `503`, `504`, with exponential backoff (100 ms base, jitter).
- `execute` and transaction patches: retried on the same failures with `replay_on_conflict=true`, so a retry after a lost response returns the original transaction instead of `409`.
- Everything else (batch, creation, proposals, approval) is never retried automatically.
- Helper `idempotencyKey(...parts)` joins non-empty parts with `:` (e.g. `idempotencyKey("order", orderId, "redeem")`). It never adds randomness.

## Tokens (server side only)

`signGrantToken({privateKey, kid, tenant, issuer, subject, ttlSeconds, access})` signs an EdDSA (Ed25519) JWT in the shape of `specs/authorization.md` of the server: claims `iss`, `sub`, `iat`, `exp`, `plinth: {tenant, access}`; header `{alg: "EdDSA", typ: "JWT", kid}`. `access` is `{admin: true}`, `{propose: true}` (proposer: reads everything, previews and proposes, never writes) or `{templates, domains, backdating?, unscoped_bucket_inputs?, propose?}`. Also `generateSigningKey()` → `{privateKey, publicKeyBase64}` where `publicKeyBase64` is the raw 32-byte key in standard base64, as `PUT /v1/auth/signing-key` expects.

## Proposals API (server)

A proposal is a pending set of new domains and templates. It changes nothing until an admin approves it; approval applies all of it atomically.

| Route | Access | Effect |
| --- | --- | --- |
| `POST /v1/proposals` | Admin or a grant with `propose: true` | Validate and store a pending proposal. `201` |
| `POST /v1/proposals?dry_run=true` | same | Validate only, store nothing. `200 {"valid": true}` |
| `GET /v1/proposals?status=&page=&per_page=` | same | List, newest first |
| `GET /v1/proposals/{id}` | same | One proposal |
| `POST /v1/proposals/{id}/approve?memo=` | Admin | Apply and mark `approved`. `200` |
| `POST /v1/proposals/{id}/reject?memo=` | Admin | Mark `rejected`. `200` |

Request body of `POST /v1/proposals`:

```json
{
  "title": "Points redemption",
  "memo": "optional free text",
  "domains": [ { "id": "points", "name": "Points", "kind": "points", "unit": "point", "parent": null } ],
  "templates": [ { "id": "redeem-v1", "domain": "points", "name": "Redeem",
      "nodes": [{ "id": "account", "op": "bucket" }, { "id": "amount", "op": "input", "value_type": "integer", "min": 1 }, { "id": "debit", "op": "post", "bucket": "account", "amount": "amount", "direction": "out" }] } ]
}
```

`domains` items have the body of `POST /v1/domains`; `templates` items have the body of `POST /v1/templates`. At least one item in total. A template may target a domain created by the same proposal. Limits: at most 32 domains and 32 templates, a `title` of up to 200 characters and a `memo` of up to 4000; more answers `400`.

Response (`Proposal`):

```json
{
  "id": "01k...", "title": "...", "memo": null,
  "domains": [], "templates": [],
  "status": "pending", "proposed_by": "user:...", "created_at": "...",
  "decided_by": null, "decided_at": null, "decision_memo": null
}
```

- Validation (create and dry run) applies the proposal inside a rolled-back savepoint on the tenant writer, so it catches the same errors approval would: id conflicts, missing parents, template compile errors. They answer `400` or `409` with the normal error envelope.
- Approval re-applies against the current state. If it fails (for example an id was taken in the meantime), it answers `409` and the proposal stays `pending`.
- Approving or rejecting a proposal that is not `pending` answers `409`. The optional decision memo is the `memo` query parameter; there is no body.
- A domain or template that already exists with an identical definition passes validation and is reused, as `POST /v1/domains` and `POST /v1/templates` are idempotent by id.
- A proposer's domains are not limited by its grant: approval is the control.
- The granular grant field `propose` (default `false`) exists on JWT `plinth.access` and on user `access`, like `backdating`.

## Test environment

Every SDK has integration tests (the `examples/` double as tests). They read:

| Variable | Meaning |
| --- | --- |
| `PLINTH_URL` | Server origin. |
| `PLINTH_EMAIL`, `PLINTH_PASSWORD` | An admin account on the tenant. |
| `PLINTH_E2E_ROOT` | Organizational root domain for test data (default `sdk-e2e`). |
| `PLINTH_E2E_LOCAL` | `1` when the server is a disposable local one. Tests that create users, rotate the signing key or need unreleased routes run only then. |

Each run creates the root if missing (create; `409` means it exists), then a child organizational domain `<root>-<runid>` (`runid`: 8 lowercase base36 chars). Every id the run creates is prefixed with `<runid>-` and stays under that child. Never write outside the root. Never rotate the signing key or create users on a non-local server.

`scripts/local-plinth.sh` builds the sibling `../plinth` checkout, provisions a throwaway tenant and starts it, then prints the env above (with `PLINTH_E2E_LOCAL=1`).
