// Wire types, written by hand from /v1/openapi.json. Field names stay snake_case as on the wire.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Metadata = Record<string, Json>;

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  has_next: boolean;
  has_previous: boolean;
}
export interface Page<T> {
  items: T[];
  pagination: Pagination;
}
export interface PageOptions {
  page?: number;
  perPage?: number;
}

export type Context = { bucket: string } | { domain: string };

export interface Posting {
  bucket: string;
  sequence: number;
  amount: number;
}
export interface Transaction {
  id: string;
  template?: string;
  patched?: string;
  idempotency_key: string;
  memo?: string;
  metadata?: Metadata;
  inputs?: Record<string, Json>;
  context?: Context;
  effective_at: string;
  created_at: string;
  actor?: string;
  postings: Posting[];
  partial: boolean;
}

/** Result of a preview: what would be written. Nothing is stored. */
export interface Preview {
  postings: { bucket: string; amount: number }[];
  provisions: { bucket: string; domain: string; attributes: Record<string, number>; reused: boolean }[];
}
export interface BatchPreview {
  operations: (Preview & { index: number; template: string })[];
}

export interface Domain {
  id: string;
  parent?: string;
  name?: string;
  kind: string;
  unit?: string;
  metadata?: Metadata;
  created_at: string;
}
export interface DomainInput {
  id: string;
  kind: string;
  name?: string;
  unit?: string;
  parent?: string | null;
  metadata?: Metadata;
}
export interface DomainSubtreeItem {
  depth: number;
  domain: Domain;
}
export interface Bucket {
  id: string;
  domain: string;
  metadata?: Metadata;
  attributes: Record<string, number>;
  created_at: string;
}
export interface BucketInput {
  id: string;
  metadata?: Metadata;
  attributes?: Record<string, number>;
}
export interface BucketPosting {
  sequence: number;
  transaction: string;
  amount: number;
  running_balance: number;
  memo?: string;
  effective_at: string;
  created_at: string;
}

/** A program node. Only the fields the SDK reads are typed. */
export interface TemplateNode {
  id: string;
  op: string;
  [field: string]: unknown;
}
export interface InputNode extends TemplateNode {
  op: "input";
  value_type: "integer" | "boolean" | "bucket" | "reference";
  min?: number | null;
  max?: number | null;
}
export interface Template {
  id: string;
  domain: string;
  name: string;
  description?: string;
  disabled: boolean;
  nodes: TemplateNode[];
  created_at: string;
}
export interface TemplateInput {
  id: string;
  domain: string;
  name: string;
  description?: string;
  nodes: TemplateNode[];
}

export interface BucketBalance {
  bucket: string;
  domain: string;
  unit: string;
  balance: number;
}
export interface DomainBalance {
  domain: string;
  unit: string;
  balance: number;
}
export type BalanceTarget = { bucket: string } | { domain: string };
export interface BalanceQueryResult {
  items: { bucket?: string; domain: string; unit: string; balance: number }[];
  consolidated: { unit: string; balance: number }[];
}
export interface DateRange {
  since?: string;
  until?: string;
}

export interface ReplayStep {
  node: string;
  op: string;
  value?: Json;
  postings: { bucket: string; sequence: number; amount: number }[];
}
export interface TransactionReplay {
  transaction: Transaction;
  steps: ReplayStep[];
  provisions: Preview["provisions"];
  matches: boolean;
}

export interface TransactionFilters extends PageOptions {
  since?: string;
  until?: string;
  template?: string;
  domain?: string;
  bucket?: string;
}

export interface ProposalInput {
  title: string;
  memo?: string;
  domains?: DomainInput[];
  templates?: TemplateInput[];
}
export type ProposalStatus = "pending" | "approved" | "rejected";
export interface Proposal {
  id: string;
  title: string;
  memo: string | null;
  domains: DomainInput[];
  templates: TemplateInput[];
  status: ProposalStatus;
  proposed_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_memo: string | null;
}

export interface GrantAccess {
  templates: string[];
  domains: string[];
  backdating?: boolean;
  unscoped_bucket_inputs?: boolean;
  propose?: boolean;
}
/** `{propose: true}` alone is the proposer level: reads everything, previews and proposes, never writes. */
export type Access = { admin: true } | { propose: true } | GrantAccess;
