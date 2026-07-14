/**
 * StubAdapter — a shipped, deterministic runtime (runtime.adapter: "stub").
 * Powers `init --demo`, tests, and offline development: it reads the machine
 * context block from the prompt and writes plausible, schema-valid artifacts
 * into staging. No network, no keys, no model.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeFm } from "../core/fm.js";
import { compactDate } from "../ids.js";
import type { RunBundle, RuntimeAdapter, RuntimeResult } from "./adapter.js";
import { extractContext } from "./prompts.js";

export class StubAdapter implements RuntimeAdapter {
  readonly name = "stub";

  async invoke(bundle: RunBundle, promptText: string): Promise<RuntimeResult> {
    const ctx = extractContext(promptText);
    switch (bundle.hat) {
      case "strategist":
        await this.strategist(bundle, ctx);
        break;
      case "content_builder":
        await this.contentBuilder(bundle, ctx);
        break;
      case "onboarding":
        await this.onboarding(bundle, ctx);
        break;
      case "planner":
      case "narrator":
        await writeFile(
          path.join(bundle.staging_dir, "narration.md"),
          `Deterministic stub narration for ${bundle.hat}. The numbers in the gap model are authoritative; this text only reads them aloud.\n`,
          "utf8",
        );
        break;
      case "channel_builder":
        await writeFile(
          path.join(bundle.staging_dir, "notes.md"),
          "Stub channel builder: no setup drafts generated (configure a real runtime for channel setup work).\n",
          "utf8",
        );
        break;
    }
    return { ok: true, detail: `stub runtime produced artifacts for ${bundle.hat}` };
  }

  private async strategist(bundle: RunBundle, ctx: Record<string, any>): Promise<void> {
    const metric: string = ctx.metric ?? "demo_signups";
    const unit: string = ctx.unit ?? "signups";
    const gap: number = typeof ctx.gap === "number" ? ctx.gap : 100;
    const first = ctx.channels?.[0];
    const channel: string = typeof first === "string" ? first : (first?.id ?? "mock");
    const date = compactDate();
    const bets = [
      {
        slug: "founder-story-thread",
        summary: `Post a 5-part founder story on ${channel}; expect +${Math.ceil(gap * 0.3)} ${unit} in 14 days`,
        target_delta: Math.ceil(gap * 0.3),
        cost_tokens: 30_000,
        cost_human_min: 10,
        risk: "reversible",
        confidence: 0.35,
        confidence_source: "doctrine",
        duration: 14,
        min_delta: Math.max(1, Math.ceil(gap * 0.08)),
        count: 5,
        theory:
          "Doctrine says the ICP follows builders, not brands. A concrete story of the problem being lived (not sold) earns replies, and replies compound reach on this surface.",
      },
      {
        slug: "comparison-page",
        summary: `Ship one honest comparison page for ${channel} distribution; expect +${Math.ceil(gap * 0.2)} ${unit} in 10 days`,
        target_delta: Math.ceil(gap * 0.2),
        cost_tokens: 20_000,
        cost_human_min: 5,
        risk: "none",
        confidence: 0.3,
        confidence_source: "doctrine",
        duration: 10,
        min_delta: Math.max(1, Math.ceil(gap * 0.05)),
        count: 1,
        theory:
          "The ICP compares before adopting. A page that names competitors honestly captures the comparison search that already happens without us.",
      },
      {
        slug: "reply-guy-sprint",
        summary: `Answer 20 in-ICP questions on ${channel} in 7 days; expect +${Math.ceil(gap * 0.1)} ${unit}`,
        target_delta: Math.ceil(gap * 0.1),
        cost_tokens: 15_000,
        cost_human_min: 0,
        risk: "none",
        confidence: 0.25,
        confidence_source: "guess",
        duration: 7,
        min_delta: Math.max(1, Math.ceil(gap * 0.03)),
        count: 3,
        theory: "Being usefully present where the ICP already asks questions is the cheapest possible test of whether our voice lands.",
      },
    ];
    for (const b of bets) {
      const id = `H-${date}-${b.slug}`;
      const fm = {
        id,
        metric,
        playbook: null,
        claim: { summary: b.summary, target_delta: b.target_delta, unit },
        economics: {
          cost_tokens: b.cost_tokens,
          cost_human_min: b.cost_human_min,
          risk: b.risk,
          confidence: b.confidence,
          confidence_source: b.confidence_source,
        },
        experiment: {
          duration_days: b.duration,
          channels: [channel],
          projects: [{ type: "content", channel, payload_type: "text", count: b.count, brief: b.summary }],
        },
        kill_criteria: { min_delta: b.min_delta, tripwires: [] },
        state: "proposed",
        disposition: "open",
      };
      const body = `## Theory\n\n${b.theory}\n\n## Experiment\n\n${b.summary}. Produced by the stub runtime — deterministic, honest about being canned. A real strategist run replaces this with research-grounded bets.\n`;
      await writeFile(path.join(bundle.staging_dir, `${id}.md`), serializeFm(fm, body), "utf8");
    }
  }

  private async contentBuilder(bundle: RunBundle, ctx: Record<string, any>): Promise<void> {
    const count: number = ctx.count ?? 1;
    const channel: string = ctx.channel ?? "mock";
    const date = compactDate();
    for (let i = 1; i <= count; i++) {
      const id = `C-${date}-${ctx.slug ?? "draft"}-${i}`;
      const dir = path.join(bundle.staging_dir, id);
      await mkdir(dir, { recursive: true });
      const fm = {
        id,
        channel,
        payload_type: "text",
        payload_file: "payload.txt",
        provenance: {
          task: ctx.task ?? 0,
          project: ctx.project ?? 0,
          hypothesis: ctx.hypothesis ?? `H-${date}-unknown`,
          metric: ctx.metric ?? "unknown",
        },
        state: "draft",
      };
      await writeFile(path.join(dir, "meta.md"), serializeFm(fm, `Draft ${i} of ${count} for ${channel}.\n`), "utf8");
      await writeFile(
        path.join(dir, "payload.txt"),
        `${ctx.brief ?? "Draft"} — take ${i}.\n\nWritten by the stub runtime to prove the loop; a real builder writes from doctrine + channel skills.\n`,
        "utf8",
      );
    }
  }

  private async onboarding(bundle: RunBundle, ctx: Record<string, any>): Promise<void> {
    await writeFile(
      path.join(bundle.staging_dir, "identity.md"),
      serializeFm(
        { draft: true },
        [
          `# Identity (draft)`,
          ``,
          `- **ICP:** ${ctx.icp ?? "(fill: who exactly buys this?)"}`,
          `- **Problem:** ${ctx.problem ?? "(fill: what pain, in their words?)"}`,
          `- **Offer:** ${ctx.offer ?? "(fill: what do they get, at what price?)"}`,
          `- **Positioning:** (fill: against what alternative?)`,
          `- **Voice:** (fill: how do we sound?)`,
          ``,
          `Drafted by the stub runtime from provided flags only. With a real runtime, this draft is built from your website/repo/Stripe and you only correct the gaps.`,
        ].join("\n"),
      ),
      "utf8",
    );
  }
}
