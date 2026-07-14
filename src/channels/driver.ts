/**
 * Channel drivers — the ontology's three verbs behind one interface.
 * Executable behavior (which binary to spawn, which MCP tool maps to which
 * verb) lives ONLY in human-owned .cronfounder/config.json; channel setup.md
 * files are descriptive. A model can draft a setup file; it cannot add an
 * executable.
 */
import { CronfounderError, EXIT } from "../errors.js";
import type { Company } from "../core/company.js";
import { MockDriver } from "./mock.js";
import { McpDriver } from "./mcp.js";

export interface PullSignal {
  id: string; // remote id, used for dedup
  signal: string; // e.g. negative_replies, unsubscribes, platform_flags
  value: number;
  at: string;
}

export interface PushResult {
  external_id: string;
}

export interface Driver {
  readonly channel: string;
  readonly capabilities: ReadonlyArray<"pull" | "push" | "subscribe">;
  /** Probe that the driver can actually operate (credentials + transport). */
  probe(): Promise<{ ok: boolean; missing: string[] }>;
  pull(since: string): Promise<PullSignal[]>;
  push(payload: { type: string; content: string; idempotency_key: string }): Promise<PushResult>;
  subscribe(): Promise<never>;
}

/**
 * Per-kind payload advisories — vendor pricing/policy quirks live with the
 * channels, never in the core push loop. One copy per fact.
 */
export function pushAdvisory(kind: string, payload: string): string | undefined {
  if (kind === "x" && /https?:\/\//i.test(payload)) {
    return "X URL-post surcharge: $0.20 at current pay-per-use pricing";
  }
  return undefined;
}

export function unsupportedCapability(channel: string, verb: string): CronfounderError {
  return new CronfounderError({
    code: "E_UNSUPPORTED_CAPABILITY",
    exit: EXIT.VALIDATION,
    problem: `channel "${channel}" does not implement ${verb}()`,
    cause: "the channel's declared capabilities do not include this verb (conformance per channel is documented, not assumed)",
    fix: `check capabilities in channels/${channel}/setup.md; the mock channel implements all three verbs`,
  });
}

export function getDriver(
  company: Company,
  channel: { id: string; kind: string; driver_ref: string | null; credential_ref: string | null; capabilities: string[] },
): Driver {
  if (channel.kind === "mock") {
    return new MockDriver(company, channel.id);
  }
  if (!channel.driver_ref) {
    throw new CronfounderError({
      code: "E_DRIVER_UNCONFIGURED",
      exit: EXIT.VALIDATION,
      problem: `channel "${channel.id}" has no driver_ref`,
      cause: "the channel is not wired to an executable driver mapping",
      fix: `add driver_ref to channels/${channel.id}/setup.md AND the matching entry under "drivers" in .cronfounder/config.json (human-owned)`,
    });
  }
  const driverCfg = company.config.drivers[channel.driver_ref];
  if (!driverCfg) {
    throw new CronfounderError({
      code: "E_DRIVER_UNCONFIGURED",
      exit: EXIT.VALIDATION,
      problem: `channel "${channel.id}" references driver "${channel.driver_ref}" which is not in .cronfounder/config.json`,
      cause: "executable driver mappings live only in the human-owned config — a setup.md reference alone spawns nothing",
      fix: `add drivers.${channel.driver_ref} to .cronfounder/config.json (see docs/commands.md#drivers for the shape)`,
    });
  }
  return new McpDriver(channel.id, channel.capabilities as Driver["capabilities"][number][], driverCfg, channel.credential_ref);
}
