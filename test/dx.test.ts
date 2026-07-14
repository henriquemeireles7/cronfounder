import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cf, tmpCompany, T0, CLI } from "./helpers.js";
import { spawnSync } from "node:child_process";
import path from "node:path";

/** Onboarding DX guarantees: exit-code contract, doctor states, next-step hints. */
describe("onboarding dx", () => {
  const t = tmpCompany();
  let dir: string;

  beforeAll(() => {
    const r = cf(t.dir, ["init", "demo", "--demo", "--yes"], { now: T0 });
    expect(r.status).toBe(0);
    dir = path.join(t.dir, "demo");

    // next-step hints work as pasted: they include the cd and the real card id
    expect(r.stdout).toContain("decide it:");
    expect(r.stdout).toContain("cd demo");
    expect(r.stdout).toContain("resolve R-1 --approve");
    // the stub is instant — it must not claim to take minutes
    expect(r.stderr).not.toContain("can take minutes");
  });
  afterAll(() => t.cleanup());

  it("doctor: pending setup (unwired channel) is ○ warn, not a failure — the keyless demo exits 0", () => {
    const r = cf(dir, ["doctor", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.ok).toBe(true);
    const x = r.json.data.checks.find((c: any) => c.name === "channel:x");
    expect(x?.ok).toBe(false);
    expect(x?.severity).toBe("warn");
  });

  it("unknown commands exit 2 (usage), per the contract", () => {
    const r = spawnSync(process.execPath, [CLI, "frobnicate"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  it("cron knows uninstall", () => {
    const r = spawnSync(process.execPath, [CLI, "cron", "--help"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("uninstall");
  });
});
