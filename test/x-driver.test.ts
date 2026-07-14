import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { oauthSignature, type OAuthParameter } from "../src/channels/x-oauth.js";
import { cf, demoCompany, tmpCompany } from "./helpers.js";

describe("X OAuth 1.0a", () => {
  it("matches the RFC 5849 HMAC-SHA1 signature example", () => {
    const oauth: OAuthParameter[] = [
      ["oauth_consumer_key", "9djdj82h48djs9d2"],
      ["oauth_token", "kkk9d7dh3k39sjv7"],
      ["oauth_signature_method", "HMAC-SHA1"],
      ["oauth_timestamp", "137131201"],
      ["oauth_nonce", "7d8f3e4a"],
    ];
    const body: OAuthParameter[] = [
      ["c2", ""],
      ["a3", "2 q"],
    ];
    const signature = oauthSignature(
      "POST",
      "http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b",
      oauth,
      "j49sk3j29djd",
      "dh893hdasih9",
      body,
    );
    expect(signature).toBe("r6/TJjbCOr97/+UU0NsvSne7s5g=");
  });
});

const { dir: root, cleanup } = tmpCompany();
let co: string;
let publishedContent: string;
const fetchFixture = fileURLToPath(new URL("./fixtures/x-fetch.mjs", import.meta.url));

const xEnv = () => ({
  X_API_KEY: "api-key",
  X_API_KEY_SECRET: "api-key-secret",
  X_ACCESS_TOKEN: "access-token",
  X_ACCESS_TOKEN_SECRET: "access-token-secret",
  X_BEARER_TOKEN: "bearer-token",
  CRONFOUNDER_X_API: "https://api.x.test",
  NODE_OPTIONS: `--import=${fetchFixture}`,
});

beforeAll(() => {
  co = demoCompany(root);
  const configFile = path.join(co, ".cronfounder", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.drivers.x.env_refs.push("CRONFOUNDER_X_API", "NODE_OPTIONS");
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

  expect(cf(co, ["resolve", "R-1", "--approve"], { now: "2026-07-13T12:30:00Z" }).status).toBe(0);
  expect(cf(co, ["build", "--quiet"], { now: "2026-07-13T12:35:00Z" }).status).toBe(0);
  const inbox = cf(co, ["inbox", "--json"], { now: "2026-07-13T12:36:00Z" });
  const cards = inbox.json.data.open.filter((card: any) => card.kind === "approve_content").slice(0, 4);
  const markers = ["a real post", "[uncertain]", "[duplicate]", "[unauthorized]"];
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    const content = card.what.match(/C-[a-z0-9-]+/)?.[0];
    if (!content) throw new Error(`content id missing from ${card.what}`);
    const contentDir = path.join(co, "content", content);
    const metaFile = path.join(contentDir, "meta.md");
    const meta = readFileSync(metaFile, "utf8").replace("channel: mock", "channel: x");
    const payloadFile = meta.match(/payload_file:\s*(\S+)/)?.[1];
    if (!payloadFile) throw new Error(`payload_file missing from ${metaFile}`);
    writeFileSync(metaFile, meta);
    writeFileSync(path.join(contentDir, payloadFile), markers[index]! + "\n");
    expect(cf(co, ["resolve", card.id, "--approve"], { now: `2026-07-13T12:${40 + index}:00Z` }).status).toBe(0);
    if (index === 0) publishedContent = content;
  }
});

afterAll(() => {
  cleanup();
});

describe("bundled X driver over stdio", () => {
  it("publishes, escalates an uncertain delivery, and records definitive failures", () => {
    const content = readdirSync(path.join(co, "content")).sort().slice(0, 4);
    const expected = new Map<string, "published" | "uncertain" | "failed">();
    expected.set(publishedContent, "published");
    for (const id of content) {
      const payload = readFileSync(path.join(co, "content", id, "payload.txt"), "utf8");
      if (payload.includes("[uncertain]")) expected.set(id, "uncertain");
      if (payload.includes("[duplicate]") || payload.includes("[unauthorized]")) expected.set(id, "failed");
    }

    for (const [id, status] of expected) {
      const result = cf(co, ["push", id, "--json"], { now: "2026-07-13T13:05:00Z", env: xEnv() });
      expect(result.status).toBe(0);
      expect(result.json.data.results[0].status).toBe(status);
      if (status === "published") expect(result.json.data.results[0].external_id).toBe("x-post-123");
      if (readFileSync(path.join(co, "content", id, "payload.txt"), "utf8").includes("[duplicate]")) {
        expect(result.json.data.results[0].detail).toContain("duplicate content");
      }
      if (readFileSync(path.join(co, "content", id, "payload.txt"), "utf8").includes("[unauthorized]")) {
        expect(result.json.data.results[0].detail).toContain("sync the machine clock");
      }
    }

    const inbox = cf(co, ["inbox", "--json"], { now: "2026-07-13T13:06:00Z" });
    const decide = inbox.json.data.open.filter((card: any) => card.kind === "decide" && card.urgent);
    expect(decide).toHaveLength(1);
    expect(decide[0].what).toContain("UNCERTAIN");
    const events = readFileSync(path.join(co, "journal", "events", "2026-07-13.jsonl"), "utf8");
    expect(events).toContain('"type":"push_uncertain"');
    expect(events).toContain('"type":"push_resolved"');
    expect(events).toContain('"outcome":"failed"');
  });

  it("reads public metrics for the publication external id", () => {
    writeFileSync(
      path.join(co, "metrics", "x_impressions.md"),
      `---\nname: x_impressions\nparent: null\nunit: impressions\ndirection: increase\nsensor:\n  type: x_post_metrics\n  content: ${publishedContent}\n  field: impression_count\n  credential_ref: X_BEARER_TOKEN\nspec: null\nstatus: null\n---\n\n# X impressions\n`,
    );
    const result = cf(co, ["sense", "--json"], { now: "2026-07-13T13:10:00Z", env: xEnv() });
    expect(result.status).toBe(0);
    expect(result.json.data.readings.find((reading: any) => reading.metric === "x_impressions").value).toBe(321);
    expect(readFileSync(path.join(co, "metrics", "x_impressions.md"), "utf8")).toContain("value: 321");
  });
});
