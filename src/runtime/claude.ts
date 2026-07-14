/**
 * ClaudeAdapter — invokes the Claude Code CLI as the borrowed runtime.
 * Verified flags (claude 2.1.x): -p, --output-format json, --allowedTools,
 * --add-dir, --max-turns. Spawned with argv arrays (shell:false), stdin
 * closed (an unauthenticated CLI prompts; closed stdin turns a hang into an
 * error), minimal env passlist, hard timeout with process-tree kill.
 */
import { spawn } from "node:child_process";
import { CronfounderError, EXIT } from "../errors.js";
import type { RunBundle, RuntimeAdapter, RuntimeResult } from "./adapter.js";

const ENV_PASSLIST = ["PATH", "HOME", "SHELL", "TERM", "USER", "LANG", "LC_ALL", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];

export class ClaudeAdapter implements RuntimeAdapter {
  readonly name = "claude";

  constructor(private command: string) {}

  async invoke(bundle: RunBundle, promptText: string, timeoutS: number): Promise<RuntimeResult> {
    const env: Record<string, string> = {};
    for (const k of ENV_PASSLIST) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
    const args = [
      "-p",
      promptText,
      "--output-format",
      "json",
      "--allowedTools",
      bundle.allowed_tools.join(","),
      "--max-turns",
      "50",
      "--add-dir",
      bundle.staging_dir,
    ];
    return await new Promise<RuntimeResult>((resolve, reject) => {
      const child = spawn(this.command, args, {
        cwd: bundle.staging_dir.replace(/\/\.cronfounder\/staging\/.*$/, ""),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        reject(
          new CronfounderError({
            code: "E_RUNTIME_TIMEOUT",
            exit: EXIT.ERROR,
            problem: `runtime "${this.command}" exceeded ${timeoutS}s for hat ${bundle.hat}`,
            cause: "the model run hung or the task is larger than the timeout allows",
            fix: `raise runtime.timeout_s in .cronfounder/config.json, or use --dry-run + 'cronfounder run import ${bundle.run_id}' to do this step yourself`,
            retryable: true,
          }),
        );
      }, timeoutS * 1000);
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new CronfounderError({
            code: "E_RUNTIME_NOT_FOUND",
            exit: EXIT.ERROR,
            problem: `runtime not found: "${this.command}"`,
            cause: e.message,
            fix: 'install Claude Code (https://claude.com/claude-code), or set runtime.command in .cronfounder/config.json, or use --dry-run',
          }),
        );
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new CronfounderError({
              code: "E_RUNTIME_FAILED",
              exit: EXIT.ERROR,
              problem: `runtime exited ${code} for hat ${bundle.hat}`,
              cause: (stderr || stdout).slice(-400) || "no output — often an unauthenticated CLI (it cannot prompt for login here)",
              fix: `verify auth: cronfounder doctor; or run the hat yourself via --dry-run + 'cronfounder run import ${bundle.run_id}'`,
              retryable: true,
            }),
          );
          return;
        }
        let detail = "";
        try {
          const parsed = JSON.parse(stdout) as { result?: string };
          detail = typeof parsed.result === "string" ? parsed.result.slice(0, 2000) : "";
        } catch {
          detail = stdout.slice(0, 2000);
        }
        resolve({ ok: true, detail });
      });
    });
  }
}
