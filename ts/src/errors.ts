/** A non-2xx response, in the server's error envelope. */
export class PlinthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rejection?: string,
    readonly node?: string,
    readonly operation?: number,
  ) {
    super(message);
    this.name = "PlinthError";
  }
}

/** Input check failed before any request. Lists every problem. */
export class PlinthValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid inputs: ${problems.join("; ")}`);
    this.name = "PlinthValidationError";
  }
}

/** `verify()` found templates that are missing or disabled. */
export class PlinthVerifyError extends Error {
  constructor(
    readonly missing: string[],
    readonly disabled: string[],
  ) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (disabled.length) parts.push(`disabled: ${disabled.join(", ")}`);
    super(`templates not usable (${parts.join("; ")})`);
    this.name = "PlinthVerifyError";
  }
}

const is = (err: unknown, status: number): err is PlinthError => err instanceof PlinthError && err.status === status;

/** A 422 `rejected` response, optionally with this guard code. */
export function isRejection(err: unknown, code?: string): err is PlinthError {
  return is(err, 422) && err.code === "rejected" && (code === undefined || err.rejection === code);
}
export const isNotFound = (err: unknown): err is PlinthError => is(err, 404);
export const isConflict = (err: unknown): err is PlinthError => is(err, 409);
export const isUnauthorized = (err: unknown): err is PlinthError => is(err, 401);

/** Join the non-empty parts with `:`. Adds no randomness. */
export function idempotencyKey(...parts: Array<string | number | bigint | null | undefined>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p) !== "")
    .map(String)
    .join(":");
}
