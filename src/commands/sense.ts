/**
 * sense — the only reality-writer (invariant I). No model calls. Failures are
 * isolated per sensor; 3 consecutive failures on one sensor file an inbox
 * card (the system reports its own broken heartbeat).
 */
import path from "node:path";
import { CronfounderError } from "../errors.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { sem } from "../output.js";
import { runSensor } from "../sensors/index.js";
import { fileRequest, credentialSteps } from "../core/inbox.js";

export interface SenseResult {
  readings: Array<{ metric: string; value: number; measured_at: string }>;
  failures: Array<{ metric: string; error: string; code: string }>;
}

export async function runSense(store: Store, out: Out): Promise<SenseResult> {
  const db = store.ledger.db;
  const metrics = db.prepare("SELECT name, sensor_type, sensor_json, file_path FROM metrics ORDER BY name").all() as Array<{
    name: string;
    sensor_type: string;
    sensor_json: string;
    file_path: string;
  }>;
  const result: SenseResult = { readings: [], failures: [] };
  for (const m of metrics) {
    const sensor = JSON.parse(m.sensor_json);
    try {
      out.progress(`sense: ${m.name} via ${m.sensor_type}…`);
      const reading = await runSensor(store.company, m.name, sensor);
      await store.commit(
        [
          store.event(`sensor:${m.sensor_type}`, "sensor_reading", {
            metric: m.name,
            value: reading.value,
            measured_at: reading.measured_at,
            sensor: m.sensor_type,
          }),
        ],
        [
          {
            kind: "patch",
            file: m.file_path,
            patches: {
              status: { value: reading.value, measured_at: reading.measured_at, written_by: `sensor:${m.sensor_type}` },
            },
          },
        ],
        [`sensor:${m.sensor_type} measured ${m.name} = ${reading.value}`],
      );
      result.readings.push({ metric: m.name, ...reading });
      out.progress(`  ${sem.status(String(reading.value))} at ${reading.measured_at}`);
    } catch (e) {
      const err = e instanceof CronfounderError ? e : null;
      const msg = err ? `${err.code}: ${err.problem}` : e instanceof Error ? e.message : String(e);
      result.failures.push({ metric: m.name, error: msg, code: err?.code ?? "E_UNEXPECTED" });
      await store.commit(
        [store.event(`sensor:${m.sensor_type}`, "sensor_failure", { metric: m.name, sensor: m.sensor_type, error: msg })],
        [],
        [`sensor:${m.sensor_type} FAILED on ${m.name}: ${msg}`],
      );
      out.progress(`  ${sem.bet("failed")}: ${msg}`);
      const failRow = db.prepare("SELECT consecutive FROM sensor_failures WHERE metric=?").get(m.name) as
        | { consecutive: number }
        | undefined;
      if (failRow && failRow.consecutive === 3) {
        const already = db
          .prepare("SELECT 1 FROM inbox WHERE state='open' AND kind IN ('provide_credential','decide') AND blocking_id=?")
          .get(m.name);
        if (!already) {
          await fileRequest(
            store,
            "core",
            err?.code === "E_CREDENTIAL_UNRESOLVED" || err?.code === "E_CREDENTIAL_REJECTED" ? "provide_credential" : "decide",
            {
              what: `sensor for metric "${m.name}" has failed ${failRow.consecutive} runs in a row`,
              why: `without this sensor the loop is blind on ${m.name} — plans computed on stale status are plans about a fictional company`,
              steps:
                err?.code === "E_CREDENTIAL_UNRESOLVED" || err?.code === "E_CREDENTIAL_REJECTED"
                  ? credentialSteps(String(sensor.credential_ref ?? "the credential env var"), `the ${m.sensor_type} sensor`)
                  : [`read the error below`, `fix the sensor config in ${path.relative(store.company.dir, m.file_path)}`, `verify: cronfounder sense`],
              blocking: `fresh status for ${m.name}; gap ranking excludes stale metrics`,
              context: msg,
              choices: [],
            },
            { blockingKind: "metric", blockingId: m.name },
          );
        }
      }
    }
  }
  return result;
}

export async function senseCommand(store: Store, out: Out): Promise<void> {
  const res = await runSense(store, out);
  if (res.readings.length === 0 && res.failures.length === 0) {
    out.noop("sense", "no metrics configured yet — add one: docs/quickstart.md#first-metric");
  }
  out.ok("sense", res, () => {
    for (const r of res.readings) out.print(`${r.metric} = ${r.value}  (${r.measured_at})`);
    for (const f of res.failures) out.print(`${f.metric}: FAILED — ${f.error}`);
  });
}
