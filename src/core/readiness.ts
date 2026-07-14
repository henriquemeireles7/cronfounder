/**
 * Readiness is COMPUTED, never declared (a resolved setup card records the
 * human's action; the core still re-checks). A bet on an unbuilt channel
 * doesn't lose points; it queues the setup and waits (readiness is a gate,
 * not a score input).
 */
import type { Store } from "./store.js";

export interface Readiness {
  ready: boolean;
  missing: string[];
}

export function channelReadiness(store: Store, channelId: string): Readiness {
  const db = store.ledger.db;
  const ch = db
    .prepare("SELECT id, kind, credential_ref, driver_ref FROM channels WHERE id=?")
    .get(channelId) as { id: string; kind: string; credential_ref: string | null; driver_ref: string | null } | undefined;
  if (!ch) return { ready: false, missing: [`channel "${channelId}" does not exist`] };
  if (ch.kind === "mock") return { ready: true, missing: [] };
  const missing: string[] = [];
  if (ch.credential_ref && !process.env[ch.credential_ref]) {
    missing.push(`credential env var ${ch.credential_ref} not set`);
  }
  if (!ch.driver_ref) {
    missing.push(`channels/${channelId}/setup.md has no driver_ref`);
  } else {
    const driver = store.company.config.drivers[ch.driver_ref];
    if (!driver) {
      missing.push(`.cronfounder/config.json has no drivers.${ch.driver_ref} mapping (human-owned)`);
    } else {
      for (const ref of driver.env_refs) {
        if (!process.env[ref]) missing.push(`driver credential env var ${ref} not set`);
      }
    }
  }
  return { ready: missing.length === 0, missing };
}

export function hypothesisReadiness(store: Store, channels: string[]): Readiness {
  const missing: string[] = [];
  for (const c of channels) {
    const r = channelReadiness(store, c);
    missing.push(...r.missing);
  }
  return { ready: missing.length === 0, missing };
}
