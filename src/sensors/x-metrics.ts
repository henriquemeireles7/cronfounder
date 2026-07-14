import { DatabaseSync } from "node:sqlite";
import { CronfounderError, EXIT } from "../errors.js";
import { iso } from "../ids.js";
import type { Company } from "../core/company.js";
import { resolveCredential, type SensorDef, type SensorReading } from "./index.js";

const FIELDS = ["impression_count", "like_count", "retweet_count", "reply_count", "quote_count", "bookmark_count"] as const;
type PublicMetric = (typeof FIELDS)[number];

export async function readXPostMetrics(company: Company, sensor: SensorDef): Promise<SensorReading> {
  const field = sensor.field ?? "impression_count";
  if (!sensor.content || !FIELDS.includes(field as PublicMetric)) {
    throw new CronfounderError({
      code: "E_SENSOR_CONFIG",
      exit: EXIT.VALIDATION,
      problem: "x_post_metrics needs a content id and a supported public_metrics field",
      cause: `content=${sensor.content ?? "missing"}, field=${field}`,
      fix: `set sensor.content to a published C-* id and sensor.field to one of: ${FIELDS.join(", ")}`,
    });
  }

  const db = new DatabaseSync(company.paths.db, { readOnly: true });
  let publication: { external_id: string } | undefined;
  try {
    publication = db
      .prepare(
        "SELECT external_id FROM publications WHERE content=? AND state='published' AND external_id IS NOT NULL ORDER BY at DESC LIMIT 1",
      )
      .get(sensor.content) as { external_id: string } | undefined;
  } finally {
    db.close();
  }
  if (!publication) {
    throw new CronfounderError({
      code: "E_SENSOR_NOT_FOUND",
      exit: EXIT.ERROR,
      problem: `x_post_metrics: ${sensor.content} has no published X external id`,
      cause: "the content has not been published successfully through the X driver",
      fix: `publish ${sensor.content} first, then run cronfounder sense again`,
    });
  }

  const token = resolveCredential(sensor.credential_ref, "x_post_metrics");
  const base = (process.env.CRONFOUNDER_X_API ?? "https://api.x.com").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/2/tweets/${encodeURIComponent(publication.external_id)}?tweet.fields=public_metrics`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CronfounderError({
      code: "E_SENSOR_NETWORK",
      exit: EXIT.ERROR,
      problem: "x_post_metrics: network failure reaching api.x.com",
      cause: error instanceof Error ? error.message : String(error),
      fix: "check connectivity and retry; same-post reads are billed once per 24 hours",
      retryable: true,
    });
  }
  if (response.status === 401) {
    throw new CronfounderError({
      code: "E_CREDENTIAL_REJECTED",
      exit: EXIT.ERROR,
      problem: "x_post_metrics: X rejected the bearer token (401)",
      cause: `the app-only bearer token in $${sensor.credential_ref} is invalid or revoked`,
      fix: "generate a bearer token in the X developer portal and update .cronfounder/env",
    });
  }
  if (response.status === 403 || response.status === 429) {
    throw new CronfounderError({
      code: "E_SENSOR_RATE_LIMIT",
      exit: EXIT.ERROR,
      problem: `x_post_metrics: X refused the read (HTTP ${response.status})`,
      cause: "the app lacks read access, or its rate/spending limit was reached",
      fix: "check the X developer app's read permission, credits, and spending cap, then retry",
      retryable: true,
    });
  }
  if (response.status === 404) {
    throw new CronfounderError({
      code: "E_SENSOR_NOT_FOUND",
      exit: EXIT.ERROR,
      problem: `x_post_metrics: X post ${publication.external_id} was not found`,
      cause: "the post was deleted, made unavailable, or the publication id is wrong",
      fix: "verify the post on x.com; point sensor.content at a current publication if needed",
    });
  }
  if (!response.ok) {
    throw new CronfounderError({
      code: "E_SENSOR_HTTP",
      exit: EXIT.ERROR,
      problem: `x_post_metrics: X returned HTTP ${response.status}`,
      cause: (await response.text()).slice(0, 200),
      fix: "retry; if persistent, check the X API status",
      retryable: response.status >= 500,
    });
  }
  const body = (await response.json()) as { data?: { public_metrics?: Partial<Record<PublicMetric, number>> } };
  const value = body.data?.public_metrics?.[field as PublicMetric];
  if (typeof value !== "number") {
    throw new CronfounderError({
      code: "E_SENSOR_SHAPE",
      exit: EXIT.ERROR,
      problem: `x_post_metrics: response had no numeric public_metrics.${field}`,
      cause: "X returned an unexpected response shape",
      fix: "verify the field is available for this post; if it persists, report the response-shape change",
    });
  }
  return { value, measured_at: iso() };
}
