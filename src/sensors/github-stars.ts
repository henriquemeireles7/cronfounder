import { CronfounderError, EXIT } from "../errors.js";
import { iso } from "../ids.js";
import type { SensorDef, SensorReading } from "./index.js";

export async function readGithubStars(sensor: SensorDef): Promise<SensorReading> {
  if (!sensor.repo || !/^[\w.-]+\/[\w.-]+$/.test(sensor.repo)) {
    throw new CronfounderError({
      code: "E_SENSOR_CONFIG",
      exit: EXIT.VALIDATION,
      problem: `github_stars sensor needs repo as "owner/name" (got: ${sensor.repo ?? "nothing"})`,
      cause: "sensor.repo is missing or malformed",
      fix: 'set sensor.repo: "owner/name" in the metric file',
    });
  }
  const base = process.env.CRONFOUNDER_GITHUB_API ?? "https://api.github.com";
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "cronfounder",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${base}/repos/${sensor.repo}`, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new CronfounderError({
      code: "E_SENSOR_NETWORK",
      exit: EXIT.ERROR,
      problem: `github_stars: network failure reaching api.github.com`,
      cause: e instanceof Error ? e.message : String(e),
      fix: "check connectivity and retry; sense isolates failures per sensor, so other metrics still updated",
      retryable: true,
    });
  }
  if (res.status === 403 || res.status === 429) {
    throw new CronfounderError({
      code: "E_SENSOR_RATE_LIMIT",
      exit: EXIT.ERROR,
      problem: `github_stars: GitHub rate limit hit (HTTP ${res.status})`,
      cause: "unauthenticated requests share 60/hour per IP",
      fix: "export GITHUB_TOKEN=<a classic token with public_repo read> — raises the limit to 5000/hour",
      retryable: true,
    });
  }
  if (res.status === 404) {
    throw new CronfounderError({
      code: "E_SENSOR_NOT_FOUND",
      exit: EXIT.ERROR,
      problem: `github_stars: repo ${sensor.repo} not found`,
      cause: "the repo was renamed, made private, or the owner/name is wrong",
      fix: "update sensor.repo in the metric file (private repos need GITHUB_TOKEN with repo scope)",
    });
  }
  if (!res.ok) {
    throw new CronfounderError({
      code: "E_SENSOR_HTTP",
      exit: EXIT.ERROR,
      problem: `github_stars: GitHub returned HTTP ${res.status}`,
      cause: (await res.text()).slice(0, 200),
      fix: "retry; if persistent, check https://www.githubstatus.com",
      retryable: true,
    });
  }
  const body = (await res.json()) as { stargazers_count?: number };
  if (typeof body.stargazers_count !== "number") {
    throw new CronfounderError({
      code: "E_SENSOR_SHAPE",
      exit: EXIT.ERROR,
      problem: "github_stars: response had no stargazers_count",
      cause: "unexpected API shape",
      fix: "report at https://github.com/henriquemeireles7/cronfounder/issues",
    });
  }
  return { value: body.stargazers_count, measured_at: iso() };
}
