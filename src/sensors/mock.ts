/**
 * Mock sensor — reads the mock channel's state file. Powers `init --demo`,
 * tests, and offline evaluation. The state file is plain JSON a human or
 * test can edit: { "value": 42, "series": [...], "signals": [...] }.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import { iso } from "../ids.js";
import type { Company } from "../core/company.js";
import type { SensorDef, SensorReading } from "./index.js";

export async function readMock(company: Company, sensor: SensorDef): Promise<SensorReading> {
  const channel = sensor.channel ?? "mock";
  const file = path.join(company.paths.mockState, `${channel}.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new CronfounderError({
      code: "E_SENSOR_CONFIG",
      exit: EXIT.ERROR,
      problem: `mock sensor: no state file at ${file}`,
      cause: "the mock channel has not been seeded",
      fix: `create it: echo '{"value": 10}' > ${file}   (init --demo does this for you)`,
    });
  }
  const state = JSON.parse(raw) as { value?: number };
  if (typeof state.value !== "number") {
    throw new CronfounderError({
      code: "E_SENSOR_SHAPE",
      exit: EXIT.ERROR,
      problem: `mock sensor: ${file} has no numeric "value"`,
      cause: "the state file was edited into an invalid shape",
      fix: `set a numeric value: {"value": 42}`,
    });
  }
  return { value: state.value, measured_at: iso() };
}
