/** Canonical hashing of frontmatter field subsets, for human-edit detection. */
import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

export function hashFields(data: Record<string, unknown>, exclude: string[]): string {
  const subset: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!exclude.includes(k)) subset[k] = v;
  }
  return createHash("sha256").update(canonical(subset)).digest("hex").slice(0, 16);
}
