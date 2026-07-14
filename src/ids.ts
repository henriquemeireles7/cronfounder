/**
 * Identifiers and time.
 *
 * All timestamps are UTC ISO-8601 with seconds precision, one format everywhere
 * (frontmatter, ledger, events, journal).
 *
 * CRONFOUNDER_NOW (ISO timestamp) freezes the clock — used by tests, demos, and
 * agents simulating seasons. Dev-facing; documented in docs/commands.md.
 */
import { randomBytes } from "node:crypto";

export function now(): Date {
  const forced = process.env.CRONFOUNDER_NOW;
  if (forced) {
    const d = new Date(forced);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function iso(d: Date = now()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function today(d: Date = now()): string {
  return iso(d).slice(0, 10);
}

export function compactDate(d: Date = now()): string {
  return today(d).replace(/-/g, "");
}

/** Sortable unique event id: <iso-compact>-<4 random bytes hex>. */
export function eventId(d: Date = now()): string {
  return `${iso(d).replace(/[-:]/g, "")}-${randomBytes(4).toString("hex")}`;
}

export function runId(d: Date = now()): string {
  return `run-${compactDate(d)}-${randomBytes(3).toString("hex")}`;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const HYP_ID_RE = /^H-\d{8}-[a-z0-9][a-z0-9-]{0,48}$/;
export const CONTENT_ID_RE = /^C-\d{8}-[a-z0-9][a-z0-9-]{0,48}$/;
export const REQUEST_ID_RE = /^R-\d+$/;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
