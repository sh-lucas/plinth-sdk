# Modelling

How to shape your business onto Plinth's primitives: what belongs in the tree, what belongs in a program, and why each feature exists.

## The primitives

| Primitive | What it is |
|:---|:---|
| **Domain** | A node in the balance tree: *organizational* (owns child domains) or *scalar* (declares a unit, owns buckets). |
| **Bucket** | An addressable slice of a scalar domain — the thing that holds a balance. |
| **Attribute** | An immutable, non-summable dimension on a bucket (expiry, unit cost, tier). |
| **Transaction** | One business event: its template, inputs, business time and postings. |
| **Posting** | A signed integer amount on one bucket, identified by `(bucket, sequence)`. |
| **Template** | A published program describing one operation. |

All of them are immutable, and all of them are created by API call. A new balance type, account or business rule never requires a code change or a migration.

## Why entity trees exist

A flat list of accounts stops working the moment someone asks "what is the total?". Domains form a tree so aggregation is structural:

```text
retail                      (organizational)
├── stock                   (organizational)
│   ├── banana-qty          (scalar, unit: unit)
│   │   ├── banana-lote-jan (bucket)
│   │   └── banana-lote-fev (bucket)
│   └── yogurt-qty          (scalar, unit: unit)
└── cash                    (scalar, unit: cent)
    └── register            (bucket)
```

The tree gives you:

1. **Scoped reads** — a bucket balance, a scalar domain balance (the sum of its buckets), or a subtree listing. `GET /v1/domains/banana-qty/balance` is the total across every lot.
2. **A unit boundary** — declared once on the scalar domain.
3. **A blast radius for programs** — a template belongs to a domain, and its execution context must sit inside that subtree.

Two rules keep it honest: scalar domains cannot own child domains, organizational domains cannot own buckets. Balances only live at the leaves.

Whether a domain is organizational or scalar is determined entirely by its `unit` field at creation: providing a `unit` (e.g. `"cent"`, `"unit"`) creates a scalar leaf domain that holds buckets; omitting `unit` creates an organizational parent domain that groups other domains. The `kind` field is a free-form, caller-defined classification label (such as `"money"`, `"stock"`, `"points"`, or `"group"`) used for business categorization and filtering via `GET /v1/domains?kind=...`; it is not an enum and does not define whether a domain is scalar or organizational.

The tree is at most 32 levels deep below a root domain: creating a domain whose parent already sits 32 levels down is rejected with `400`. Subtree listings, granted scopes and template execution contexts all cover that full depth.

### Choosing granularity

The bucket is the unit of *addressability and history*. Split into buckets whatever you will later consume, expire or report on independently — lots, wallets, customers, projects. Use attributes for what you will *filter or order by* but never sum.

If you want to update an attribute, you have modelled a balance or a new bucket as an attribute. Attributes are frozen on purpose: FEFO ordering and lot identity depend on it.

## Why transactions and postings are separate

The transaction is the *event*; postings are its *effects*. One sale debits a lot, debits a second when the first runs out, and credits the register — one transaction, three postings.

If every posting condition is false, the template still records the event with no postings and leaves balances unchanged.

The transaction retains the template that produced it, the `context` it ran against, the exact `inputs`, `effective_at` (business time), the insertion time (system time) and caller metadata.

`effective_at` is also the reference time for the program's reads, so windowed reads inside a backdated operation agree with the write being created.

**Every execution can be replayed.** `GET /v1/transactions/{id}/replay` (admin only) runs the template again against the ledger exactly as it stood just before that transaction, ignoring everything written after it, and returns the value each node saw (inputs, balances, comparisons, the lots an `allocate` drained, the buckets a `provision` opened) together with `matches`: whether it reproduces the recorded postings. A replay writes nothing. Patches have no program to replay, and executions recorded before v0.3.4 lack the context they ran against, so both answer `409`.

**Nothing is edited.** Corrections use *patches*: a new transaction linked to the original carrying the delta, or only a memo when no balance change is needed. Patches are the only direct posting path, they bypass template guards, and they require an explicit memo.

## Why templates exist

A template answers "who may change this balance, and under what conditions". It is a flat, ordered list of nodes published against a domain, and it is immutable — changing a rule means publishing a new template, so every transaction forever points at the exact program version that produced it.

Callers never post directly:

```http
POST /v1/transactions/execute/{template}
Idempotency-Key: sale:2026-08-16:0001

{ "context": { "bucket": "banana-lote-jan" }, "inputs": { "qty": 6, "price": 100 } }
```

Business rules stop being scattered across whichever service happened to write the row. And because the program is data, it is also the visualization source — the CLI ships a Mermaid exporter.

See [Programs](programs.md) for the node specification.

## Why each feature exists

**Context.** An operation names a bucket (`{"context":{"bucket":"customer-a"}}`) or a domain. Bucket context is the common case. Domain context exists for cold bootstrap, where the bucket does not exist yet and the program will create it. For a template on a scalar domain, context may be omitted.

**Provisioning.** Intake flows do not have the account ready in advance: a goods receipt learns the lot from the delivery. `provision` opens the bucket, stamps its immutable attributes and lets later nodes in the same operation post into it — no create-then-post race. Its conflict policy is business policy: `reuse` adds a second delivery to the existing lot (rejecting mismatched attributes), `fail` makes a reference openable exactly once.

**Allocation.** A sale rarely maps to one bucket. `allocate` drains lots in order — FIFO by insertion order or FEFO by an immutable attribute — until the amount is satisfied, optionally filtered by that same attribute and optionally rejecting when it cannot be filled. A `limit` on buckets scanned keeps the cost knowable. `allocate.value` closes the loop for costing: per consumed bucket it reads that bucket's unit-cost attribute, multiplies by the amount taken and posts it — per-lot COGS in the same transaction.

**Guards.** `require` enforces invariants at write time and rejects with a stable machine-readable code. There are no stored balance constraints: "must not go negative" is a policy of *this operation*, not of the bucket — a sale should refuse while a correction or a postpaid meter should not, and both write to the same bucket.

**Preview.** `POST /v1/transactions/preview/{template}` runs the identical program on the identical path and rolls back. Use it for quoting and UI validation.

**Batches.** Up to 256 operations in one atomic request. A failure reports the zero-based index of the offending line, and buckets provisioned by earlier lines roll back too.

**Idempotency.** Every `execute`, `batch` and transaction `patch` request, and every metadata patch, requires an `Idempotency-Key` header; previews take none. Keys share one tenant-wide namespace and are permanently consumed: reuse returns `409 idempotency_key_reused`. An identical `execute` or `patch` retry with `replay_on_conflict=true` returns the original transaction when the caller can see it; metadata patches have no replay. Resource creation (domains, buckets, templates) is idempotent by the caller-supplied `id` instead. A ledger reachable over an unreliable network needs retries to be safe by default, so this is mandatory rather than opt-in.

## Reading the ledger

- `GET /v1/buckets/{bucket}/balance` and `GET /v1/domains/{domain}/balance`
- `POST` or `QUERY /v1/balances/query` for up to 256 balances and consolidation by unit
- paginated listings of domains, subtrees, buckets and attributes; domain and bucket listings accept an optional textual `q` search (up to 256 characters), and subtree pagination preserves preorder traversal
- posting timelines per bucket
- transactions filtered by date window (`since`, `until`), `template`, `bucket` or `domain` (including its subtree)
- `GET /v1/transactions/idempotency/{key}`
- immutable metadata patch history for domains, buckets and transactions

Balances are always derived from postings; daily rollups only accelerate the read.

## A modelling checklist

1. What is the smallest unit you will ever count? That is the scalar domain's unit.
2. What must be summed? Buckets and domains. What is only filtered or ordered? Attributes.
3. What must be aggregated together? Put it under a common organizational domain.
4. What are the operations, and what must each refuse to do? One template per operation, one guard per refusal.
5. Does the operation create its own account? It needs `provision` and a conflict policy.
6. Does it consume across several buckets? It needs `allocate`, with a limit and an ordering.
7. What does the caller retry with? That is the idempotency key.
