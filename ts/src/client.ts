import { PlinthError, PlinthVerifyError } from "./errors.js";
import type {
  BalanceQueryResult, BalanceTarget, BatchPreview, Bucket, BucketBalance, BucketInput, BucketPosting, Context,
  DateRange, Domain, DomainBalance, DomainInput, DomainSubtreeItem, Json, Metadata, Page, PageOptions,
  Preview, Proposal, ProposalInput, ProposalStatus, Template, TemplateInput, Transaction, TransactionFilters,
  TransactionReplay,
} from "./types.js";
import { validateInputs } from "./validate.js";

export interface ClientOptions {
  /** Server origin. The SDK adds `/v1`. */
  baseUrl: string;
  /** A bearer token. Exclusive with `credentials`. */
  token?: string;
  /** The SDK logs in lazily and once more after a 401. Exclusive with `token`. */
  credentials?: { email: string; password: string };
  /** Retry budget for safe retries. Default 2. */
  retries?: number;
  /** Check inputs against the template before execute and preview. Default true. */
  validateInputs?: boolean;
  /** Custom fetch, for tests. */
  fetch?: typeof fetch;
}

type Inputs = Record<string, number | bigint | string | boolean>;
export interface PreviewOptions {
  context?: Context;
  inputs?: Inputs;
  effectiveAt?: string;
  metadata?: Metadata;
  memo?: string;
}
export interface ExecuteOptions extends PreviewOptions {
  idempotencyKey: string;
}
export interface PatchOptions {
  memo: string;
  postings: { bucket: string; amount: number }[];
  effectiveAt?: string;
  metadata?: Metadata;
  idempotencyKey: string;
}

interface Req {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Safe to retry on network errors, 502, 503, 504. */
  retry?: boolean;
  text?: boolean;
}

/** JSON.stringify that also writes bigint as a plain number. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `__big:${v}` : v)).replace(/"__big:(-?\d+)"/g, "$1");
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

function wireOp(o: PreviewOptions & { template?: string }) {
  return {
    ...(o.template !== undefined && { template: o.template }),
    ...(o.context && { context: o.context }),
    inputs: o.inputs ?? {},
    ...(o.memo !== undefined && { memo: o.memo }),
    ...(o.metadata && { metadata: o.metadata }),
    ...(o.effectiveAt && { effective_at: o.effectiveAt }),
  };
}

export class PlinthClient {
  private readonly base: string;
  private readonly retries: number;
  private readonly doFetch: typeof fetch;
  private readonly validate: boolean;
  private readonly credentials?: { email: string; password: string };
  private token?: string;
  private login?: Promise<string>;
  private readonly cache = new Map<string, Promise<Template>>();

  constructor(opts: ClientOptions) {
    if (opts.token && opts.credentials) throw new Error("use either token or credentials, not both");
    this.base = opts.baseUrl.replace(/\/+$/, "") + "/v1";
    this.retries = opts.retries ?? 2;
    this.validate = opts.validateInputs ?? true;
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.token = opts.token;
    this.credentials = opts.credentials;
  }

  // ---- transport ----

  private async authHeader(): Promise<Record<string, string>> {
    if (!this.token && this.credentials) {
      this.login ??= this.doLogin().finally(() => (this.login = undefined));
      this.token = await this.login;
    }
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private async doLogin(): Promise<string> {
    const res = await this.doFetch(`${this.base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.credentials),
    });
    if (!res.ok) throw await toError(res);
    return ((await res.json()) as { token: string }).token;
  }

  private async send<T>(method: string, path: string, r: Req = {}): Promise<T> {
    const qs = Object.entries(r.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${enc(String(v))}`)
      .join("&");
    const url = `${this.base}${path}${qs ? "?" + qs : ""}`;
    let attempt = 0;
    let relogged = false;
    for (;;) {
      const headers: Record<string, string> = { ...(await this.authHeader()), ...r.headers };
      if (r.body !== undefined) headers["Content-Type"] = "application/json";
      let res: Response;
      try {
        res = await this.doFetch(url, { method, headers, body: r.body === undefined ? undefined : stringify(r.body) });
      } catch (err) {
        if (r.retry && attempt < this.retries) {
          await sleep(backoff(attempt++));
          continue;
        }
        throw err;
      }
      if (res.status === 401 && this.credentials && !relogged) {
        relogged = true;
        this.token = undefined;
        continue;
      }
      if (r.retry && [502, 503, 504].includes(res.status) && attempt < this.retries) {
        await res.arrayBuffer().catch(() => undefined);
        await sleep(backoff(attempt++));
        continue;
      }
      if (!res.ok) throw await toError(res);
      if (r.text) return (await res.text()) as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  private get = <T>(path: string, query?: Req["query"]) => this.send<T>("GET", path, { query, retry: true });
  private async *all<T>(fetchPage: (page: number) => Promise<Page<T>>): AsyncGenerator<T, void, void> {
    for (let page = 1; ; page++) {
      const p = await fetchPage(page);
      yield* p.items;
      if (!p.pagination.has_next) return;
    }
  }

  // ---- templates ----

  /** Template by id, cached per client. Ids are immutable. */
  private cachedTemplate(id: string): Promise<Template> {
    let t = this.cache.get(id);
    if (!t) {
      t = this.templates.get(id);
      t.catch(() => this.cache.delete(id));
      this.cache.set(id, t);
    }
    return t;
  }

  private async checked(template: string, o: PreviewOptions) {
    if (this.validate) validateInputs(await this.cachedTemplate(template), o.inputs);
    return wireOp(o);
  }

  // ---- operations ----

  async execute(template: string, o: ExecuteOptions): Promise<Transaction> {
    return this.send("POST", `/transactions/execute/${enc(template)}`, {
      body: await this.checked(template, o),
      query: { replay_on_conflict: true },
      headers: { "Idempotency-Key": o.idempotencyKey },
      retry: true,
    });
  }

  async preview(template: string, o: PreviewOptions = {}): Promise<Preview> {
    return this.send("POST", `/transactions/preview/${enc(template)}`, { body: await this.checked(template, o), retry: true });
  }

  batch = (operations: (PreviewOptions & { template: string })[], o: { idempotencyKey: string }) =>
    this.send<{ transactions: Transaction[] }>("POST", "/transactions/batch", {
      body: { operations: operations.map(wireOp) },
      headers: { "Idempotency-Key": o.idempotencyKey },
    }).then((r) => r.transactions);

  batchPreview = (operations: (PreviewOptions & { template: string })[]) =>
    this.send<BatchPreview>("POST", "/transactions/batch/preview", { body: { operations: operations.map(wireOp) }, retry: true });

  /** Fetch every template. Throw one error that lists the missing or disabled ones. */
  async verify(templateIds: string[]): Promise<void> {
    const missing: string[] = [];
    const disabled: string[] = [];
    await Promise.all(
      templateIds.map(async (id) => {
        try {
          if ((await this.templates.get(id)).disabled) disabled.push(id);
        } catch (err) {
          if (err instanceof PlinthError && err.status === 404) missing.push(id);
          else throw err;
        }
      }),
    );
    if (missing.length || disabled.length) throw new PlinthVerifyError(missing.sort(), disabled.sort());
  }

  // ---- resources ----

  balances = {
    bucket: (id: string, r: DateRange = {}) => this.get<BucketBalance>(`/buckets/${enc(id)}/balance`, { ...r }),
    domain: (id: string, r: DateRange = {}) => this.get<DomainBalance>(`/domains/${enc(id)}/balance`, { ...r }),
    query: (targets: BalanceTarget[], r: DateRange = {}) =>
      this.send<BalanceQueryResult>("POST", "/balances/query", { body: { targets, ...r }, retry: true }),
  };

  transactions = {
    list: ({ perPage, ...f }: TransactionFilters = {}) => this.get<Page<Transaction>>("/transactions", { ...f, per_page: perPage }),
    listAll: (f: TransactionFilters = {}) => this.all((page) => this.transactions.list({ ...f, page })),
    get: (id: string) => this.get<Transaction>(`/transactions/${enc(id)}`),
    byIdempotencyKey: (key: string) => this.get<Transaction>(`/transactions/idempotency/${enc(key)}`),
    /** Admin or proposer level. Re-run the template against the ledger as it was. Writes nothing. */
    replay: (id: string) => this.get<TransactionReplay>(`/transactions/${enc(id)}/replay`),
    /** Admin. Direct correction; bypasses template guards. */
    patch: (id: string, o: PatchOptions) =>
      this.send<Transaction>("POST", `/transactions/${enc(id)}/patch`, {
        body: {
          memo: o.memo,
          postings: o.postings,
          ...(o.effectiveAt && { effective_at: o.effectiveAt }),
          ...(o.metadata && { metadata: o.metadata }),
        },
        query: { replay_on_conflict: true },
        headers: { "Idempotency-Key": o.idempotencyKey },
        retry: true,
      }),
  };

  templates = {
    list: (f: PageOptions & { domain?: string; disabled?: boolean } = {}) =>
      this.get<Page<Template>>("/templates", { domain: f.domain, disabled: f.disabled, page: f.page, per_page: f.perPage }),
    listAll: (f: { domain?: string; disabled?: boolean } = {}) => this.all((page) => this.templates.list({ ...f, page })),
    get: (id: string) => this.get<Template>(`/templates/${enc(id)}`),
    diagram: (id: string) => this.send<string>("GET", `/templates/${enc(id)}/diagram`, { retry: true, text: true }),
    /** Admin. */
    publish: (t: TemplateInput) => this.send<Template>("POST", "/templates", { body: t }),
    /** Admin. */
    setDisabled: (id: string, disabled: boolean) => this.send<Template>("PATCH", `/templates/${enc(id)}`, { body: { disabled } }),
  };

  domains = {
    list: (f: PageOptions & { kind?: string; parent?: string; q?: string } = {}) =>
      this.get<Page<Domain>>("/domains", { kind: f.kind, parent: f.parent, q: f.q, page: f.page, per_page: f.perPage }),
    listAll: (f: { kind?: string; parent?: string; q?: string } = {}) => this.all((page) => this.domains.list({ ...f, page })),
    get: (id: string) => this.get<Domain>(`/domains/${enc(id)}`),
    children: (id: string, f: PageOptions & { kind?: string; q?: string } = {}) =>
      this.get<Page<Domain>>(`/domains/${enc(id)}/children`, { kind: f.kind, q: f.q, page: f.page, per_page: f.perPage }),
    subtree: (id: string, f: PageOptions = {}) =>
      this.get<Page<DomainSubtreeItem>>(`/domains/${enc(id)}/subtree`, { page: f.page, per_page: f.perPage }),
    subtreeAll: (id: string) => this.all((page) => this.domains.subtree(id, { page })),
    buckets: (id: string, f: PageOptions & { q?: string } = {}) =>
      this.get<Page<Bucket>>(`/domains/${enc(id)}/buckets`, { q: f.q, page: f.page, per_page: f.perPage }),
    bucketsAll: (id: string, f: { q?: string } = {}) => this.all((page) => this.domains.buckets(id, { ...f, page })),
    /** Admin. */
    create: (d: DomainInput) => this.send<Domain>("POST", "/domains", { body: d }),
  };

  buckets = {
    get: (id: string) => this.get<Bucket>(`/buckets/${enc(id)}`),
    postings: (id: string, f: PageOptions & DateRange = {}) =>
      this.get<Page<BucketPosting>>(`/buckets/${enc(id)}/postings`, { since: f.since, until: f.until, page: f.page, per_page: f.perPage }),
    postingsAll: (id: string, f: DateRange = {}) => this.all((page) => this.buckets.postings(id, { ...f, page })),
    /** Admin. */
    create: (domain: string, b: BucketInput) => this.send<Bucket>("POST", `/domains/${enc(domain)}/buckets`, { body: b }),
  };

  proposals = {
    create: (p: ProposalInput) => this.send<Proposal>("POST", "/proposals", { body: p }),
    /** Dry run: validate and store nothing. */
    validate: (p: ProposalInput) =>
      this.send<{ valid: true }>("POST", "/proposals", { body: p, query: { dry_run: true }, retry: true }),
    list: (f: PageOptions & { status?: ProposalStatus } = {}) =>
      this.get<Page<Proposal>>("/proposals", { status: f.status, page: f.page, per_page: f.perPage }),
    listAll: (f: { status?: ProposalStatus } = {}) => this.all((page) => this.proposals.list({ ...f, page })),
    get: (id: string) => this.get<Proposal>(`/proposals/${enc(id)}`),
    approve: (id: string, o: { memo?: string } = {}) => this.send<Proposal>("POST", `/proposals/${enc(id)}/approve`, { query: { memo: o.memo } }),
    reject: (id: string, o: { memo?: string } = {}) => this.send<Proposal>("POST", `/proposals/${enc(id)}/reject`, { query: { memo: o.memo } }),
  };
}

function backoff(attempt: number): number {
  return 100 * 2 ** attempt * (1 + Math.random() * 0.5);
}

async function toError(res: Response): Promise<PlinthError> {
  const text = await res.text().catch(() => "");
  try {
    const b = JSON.parse(text) as { code?: string; message?: string; rejection?: string; node?: string; operation?: number };
    return new PlinthError(res.status, b.code ?? "unknown", b.message ?? res.statusText, b.rejection, b.node, b.operation);
  } catch {
    return new PlinthError(res.status, "unknown", text || res.statusText);
  }
}

export type { Json };
