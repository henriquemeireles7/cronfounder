/**
 * Generic MCP driver — the deterministic core IS the MCP client (no model in
 * the side-effect path). The complete executable mapping (server command,
 * verb→tool, argument template, response extraction) comes from human-owned
 * config. Extraction is dot-path with numeric indexes only ("content.0.text").
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CronfounderError, EXIT } from "../errors.js";
import type { Config } from "../core/company.js";
import { unsupportedCapability, type Driver, type PullSignal, type PushResult } from "./driver.js";

type DriverCfg = Config["drivers"][string];

function dotGet(obj: unknown, dotPath: string): unknown {
  if (dotPath === "") return obj;
  let cur: any = obj;
  for (const part of dotPath.split(".")) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(part) ? Number(part) : part];
  }
  return cur;
}

function renderTemplate(template: Record<string, unknown>, vars: Record<string, string>): Record<string, unknown> {
  const render = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
    }
    if (Array.isArray(v)) return v.map(render);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, render(x)]));
    }
    return v;
  };
  return render(template) as Record<string, unknown>;
}

export class McpDriver implements Driver {
  constructor(
    readonly channel: string,
    readonly capabilities: ReadonlyArray<"pull" | "push" | "subscribe">,
    private cfg: DriverCfg,
    private credentialRef: string | null,
  ) {}

  async probe(): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];
    if (this.credentialRef && !process.env[this.credentialRef]) {
      missing.push(`env var ${this.credentialRef} not set`);
    }
    for (const ref of this.cfg.env_refs) {
      if (!process.env[ref]) missing.push(`env var ${ref} not set`);
    }
    if (missing.length > 0) return { ok: false, missing };
    try {
      await this.withClient(async (client) => {
        await client.listTools();
      }, 15_000);
      return { ok: true, missing: [] };
    } catch (e) {
      return { ok: false, missing: [`driver probe failed: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  private async withClient<T>(fn: (client: Client) => Promise<T>, timeoutMs: number): Promise<T> {
    // Minimal env passlist + exactly the credentials this driver declares.
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    };
    for (const ref of [...this.cfg.env_refs, ...(this.credentialRef ? [this.credentialRef] : [])]) {
      const v = process.env[ref];
      if (v) env[ref] = v;
    }
    const transport = new StdioClientTransport({
      command: this.cfg.command,
      args: this.cfg.args,
      env,
      stderr: "ignore",
    });
    const client = new Client({ name: "cronfounder", version: "0.1.0" });
    const timer = setTimeout(() => {
      void client.close();
    }, timeoutMs);
    try {
      await client.connect(transport);
      return await fn(client);
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => {});
    }
  }

  private toolFor(verb: "push" | "pull"): NonNullable<DriverCfg["tools"][string]> {
    const t = this.cfg.tools[verb];
    if (!t) {
      throw new CronfounderError({
        code: "E_DRIVER_VERB_UNMAPPED",
        exit: EXIT.VALIDATION,
        problem: `driver for channel "${this.channel}" maps no MCP tool to ${verb}()`,
        cause: `config.json drivers.<ref>.tools.${verb} is missing`,
        fix: `add the ${verb} tool mapping to .cronfounder/config.json (human-owned)`,
      });
    }
    return t;
  }

  async pull(since: string): Promise<PullSignal[]> {
    if (!this.capabilities.includes("pull")) throw unsupportedCapability(this.channel, "pull");
    const tool = this.toolFor("pull");
    const result = await this.withClient(
      (client) => client.callTool({ name: tool.tool, arguments: renderTemplate(tool.args_template, { since }) }),
      tool.timeout_s * 1000,
    );
    const extracted = dotGet(result, tool.extract);
    if (!Array.isArray(extracted)) return [];
    return extracted
      .filter((s: any) => s && typeof s.id === "string" && typeof s.signal === "string")
      .map((s: any) => ({ id: s.id, signal: s.signal, value: Number(s.value ?? 1), at: String(s.at ?? since) }));
  }

  async push(payload: { type: string; content: string; idempotency_key: string }): Promise<PushResult> {
    if (!this.capabilities.includes("push")) throw unsupportedCapability(this.channel, "push");
    const tool = this.toolFor("push");
    let result: unknown;
    try {
      result = await this.withClient(
        (client) =>
          client.callTool({
            name: tool.tool,
            arguments: renderTemplate(tool.args_template, {
              text: payload.content,
              content: payload.content,
              idempotency_key: payload.idempotency_key,
            }),
          }),
        tool.timeout_s * 1000,
      );
    } catch (e) {
      // The caller (push command) records push_uncertain and files a decide
      // card — an uncertain delivery is NEVER auto-retried.
      throw new CronfounderError({
        code: "E_PUSH_UNCERTAIN",
        exit: EXIT.ERROR,
        problem: `push to "${this.channel}" failed mid-call: ${e instanceof Error ? e.message : String(e)}`,
        cause: "the MCP call errored or timed out after the request may have reached the platform",
        fix: "cronfounder recorded the uncertainty and filed a decide card — verify on the platform, then resolve the card; do NOT re-run push blindly",
      });
    }
    const isError = (result as { isError?: boolean } | undefined)?.isError === true;
    if (isError) {
      const text = dotGet(result, "content.0.text");
      if (typeof text === "string" && text.startsWith("E_PUSH_UNCERTAIN:")) {
        throw new CronfounderError({
          code: "E_PUSH_UNCERTAIN",
          exit: EXIT.ERROR,
          problem: text.slice("E_PUSH_UNCERTAIN:".length).trim(),
          cause: "the platform request ended without a response after it may have been delivered",
          fix: "verify on the platform before retrying; cronfounder will file a decide card",
        });
      }
      throw new CronfounderError({
        code: "E_DRIVER_TOOL_ERROR",
        exit: EXIT.ERROR,
        problem: `channel "${this.channel}" tool "${tool.tool}" returned an error`,
        cause: typeof text === "string" ? text.slice(0, 300) : "tool reported isError with no text",
        fix: "check the driver server's credentials and the args_template in .cronfounder/config.json",
      });
    }
    const external = dotGet(result, tool.extract);
    return { external_id: typeof external === "string" ? external : payload.idempotency_key };
  }

  subscribe(): Promise<never> {
    throw unsupportedCapability(this.channel, "subscribe");
  }
}
