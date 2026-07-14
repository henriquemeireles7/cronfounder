/**
 * Sensors: deliberately dumb, plain REST, no model calls. The ONLY writers
 * of reality (invariant I). Raw API payloads are discarded after extraction —
 * only the computed value is stored (no customer PII in events or ledger).
 */
import { CronfounderError, EXIT } from "../errors.js";
import type { Company } from "../core/company.js";
import { readGithubStars } from "./github-stars.js";
import { readStripeMrr } from "./stripe-mrr.js";
import { readMock } from "./mock.js";

export interface SensorReading {
  value: number;
  measured_at: string;
}

export interface SensorDef {
  type: string;
  repo?: string;
  credential_ref?: string;
  channel?: string;
}

export async function runSensor(company: Company, metric: string, sensor: SensorDef): Promise<SensorReading> {
  switch (sensor.type) {
    case "github_stars":
      return readGithubStars(sensor);
    case "stripe_mrr":
      return readStripeMrr(company, sensor);
    case "mock":
      return readMock(company, sensor);
    default:
      throw new CronfounderError({
        code: "E_SENSOR_UNKNOWN",
        exit: EXIT.VALIDATION,
        problem: `metric "${metric}" declares unknown sensor type "${sensor.type}"`,
        cause: "sensor.type must be one of: github_stars, stripe_mrr, mock",
        fix: `edit metrics/${metric}.md and set sensor.type to a supported sensor`,
      });
  }
}

export function resolveCredential(ref: string | undefined, sensorName: string): string {
  if (!ref) {
    throw new CronfounderError({
      code: "E_CREDENTIAL_REF_MISSING",
      exit: EXIT.VALIDATION,
      problem: `${sensorName} requires a credential_ref (the NAME of an environment variable)`,
      cause: "the sensor config names no credential reference — secrets are never stored in files (invariant IV)",
      fix: `add sensor.credential_ref (e.g. "STRIPE_API_KEY") to the metric file, then export that variable`,
    });
  }
  const value = process.env[ref];
  if (!value) {
    throw new CronfounderError({
      code: "E_CREDENTIAL_UNRESOLVED",
      exit: EXIT.ERROR,
      problem: `credential reference "${ref}" is not set in the environment`,
      cause:
        "the env var is missing here — common under cron, which does not load your shell profile",
      fix: `export ${ref}=... (interactive), or add it to the env file your cron lines source (see: cronfounder cron print); verify with: cronfounder doctor`,
    });
  }
  return value;
}
