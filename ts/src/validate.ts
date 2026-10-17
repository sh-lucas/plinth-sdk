import { PlinthValidationError } from "./errors.js";
import type { InputNode, Template } from "./types.js";

const REF = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Check `inputs` against the template's `input` nodes. Returns every problem found. */
export function checkInputs(template: Template, inputs: Record<string, unknown> = {}): string[] {
  const nodes = template.nodes.filter((n): n is InputNode => n.op === "input");
  const problems: string[] = [];
  const known = new Set(nodes.map((n) => n.id));
  for (const key of Object.keys(inputs)) if (!known.has(key)) problems.push(`unknown input "${key}"`);
  for (const node of nodes) {
    const v = inputs[node.id];
    if (v === undefined) {
      problems.push(`missing input "${node.id}"`);
    } else if (node.value_type === "integer") {
      const ok = typeof v === "bigint" || (typeof v === "number" && Number.isSafeInteger(v));
      if (!ok) problems.push(`input "${node.id}" must be a safe integer or bigint`);
      else {
        if (node.min != null && BigInt(v) < BigInt(node.min)) problems.push(`input "${node.id}" is below min ${node.min}`);
        if (node.max != null && BigInt(v) > BigInt(node.max)) problems.push(`input "${node.id}" is above max ${node.max}`);
      }
    } else if (node.value_type === "bucket" || node.value_type === "reference") {
      if (typeof v !== "string" || !REF.test(v)) problems.push(`input "${node.id}" must match ${REF}`);
    }
  }
  return problems;
}

export function validateInputs(template: Template, inputs?: Record<string, unknown>): void {
  const problems = checkInputs(template, inputs);
  if (problems.length) throw new PlinthValidationError(problems);
}
