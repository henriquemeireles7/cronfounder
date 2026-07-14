/**
 * Mock channel driver — implements all three verbs against a JSON state file
 * (.cronfounder/mock/<channel>.json). Contract-tested; powers demo + e2e.
 * State shape:
 *   { value: number, posts: [{id, content, at}], signals: [{id, signal, value, at}] }
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Company } from "../core/company.js";
import { iso } from "../ids.js";
import { unsupportedCapability, type Driver, type PullSignal, type PushResult } from "./driver.js";

interface MockState {
  value: number;
  posts: Array<{ id: string; content: string; at: string }>;
  signals: Array<{ id: string; signal: string; value: number; at: string }>;
}

export class MockDriver implements Driver {
  readonly capabilities = ["pull", "push", "subscribe"] as const;

  constructor(
    private company: Company,
    readonly channel: string,
  ) {}

  private get file(): string {
    return path.join(this.company.paths.mockState, `${this.channel}.json`);
  }

  private async load(): Promise<MockState> {
    try {
      const raw = await readFile(this.file, "utf8");
      const s = JSON.parse(raw) as Partial<MockState>;
      return { value: s.value ?? 0, posts: s.posts ?? [], signals: s.signals ?? [] };
    } catch {
      return { value: 0, posts: [], signals: [] };
    }
  }

  private async save(state: MockState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  async probe(): Promise<{ ok: boolean; missing: string[] }> {
    return { ok: true, missing: [] };
  }

  async pull(since: string): Promise<PullSignal[]> {
    const state = await this.load();
    return state.signals.filter((s) => s.at >= since);
  }

  async push(payload: { type: string; content: string; idempotency_key: string }): Promise<PushResult> {
    const state = await this.load();
    const existing = state.posts.find((p) => p.id === payload.idempotency_key);
    if (existing) return { external_id: existing.id }; // idempotent
    state.posts.push({ id: payload.idempotency_key, content: payload.content, at: iso() });
    await this.save(state);
    return { external_id: payload.idempotency_key };
  }

  subscribe(): Promise<never> {
    throw unsupportedCapability(this.channel, "subscribe (runtime handlers are v2; the verb is contract-declared)");
  }
}
