import { describe, expect, it } from "vitest";
import { computeVerdict } from "../src/core/verdict.js";
import { leverage, compareByLeverage } from "../src/core/leverage.js";
import { computeMrrMinor } from "../src/sensors/stripe-mrr.js";
import { HypothesisSchema } from "../src/core/schema.js";
import {
  assertContentTransition,
  assertHypothesisTransition,
} from "../src/core/states.js";
import { CronfounderError } from "../src/errors.js";

const reading = (id: number, value: number, at: string) => ({ id, value, measured_at: at });

describe("verdict math (invariant IX)", () => {
  const base = {
    direction: "increase" as const,
    baseline_value: 40,
    min_delta: 10,
    review_at: "2026-07-28T12:00:00Z",
    freshness_hours: 48,
  };
  it("validates when direction-adjusted delta ≥ min_delta", () => {
    const out = computeVerdict({ ...base, readings: [reading(1, 40, "2026-07-13T12:00:00Z"), reading(2, 55, "2026-07-28T09:00:00Z")] });
    expect(out).toMatchObject({ kind: "verdict", result: "validated", delta: 15 });
  });
  it("invalidates below threshold (exact boundary is ≥)", () => {
    const at = "2026-07-28T09:00:00Z";
    expect(computeVerdict({ ...base, readings: [reading(1, 49.9, at)] })).toMatchObject({ result: "invalidated" });
    expect(computeVerdict({ ...base, readings: [reading(1, 50, at)] })).toMatchObject({ result: "validated" });
  });
  it("uses the LAST reading at-or-before review_at, ignoring later ones", () => {
    const out = computeVerdict({
      ...base,
      readings: [reading(1, 45, "2026-07-28T09:00:00Z"), reading(2, 500, "2026-07-29T09:00:00Z")],
    });
    expect(out).toMatchObject({ kind: "verdict", result: "invalidated", delta: 5 });
  });
  it("is inconclusive with no reading before review_at", () => {
    expect(computeVerdict({ ...base, readings: [reading(1, 90, "2026-07-30T00:00:00Z")] }).kind).toBe("inconclusive");
  });
  it("is inconclusive when the terminal reading is stale", () => {
    expect(computeVerdict({ ...base, readings: [reading(1, 90, "2026-07-13T12:00:00Z")] }).kind).toBe("inconclusive");
  });
  it("handles decreasing metrics direction-adjusted", () => {
    const out = computeVerdict({
      ...base,
      direction: "decrease",
      baseline_value: 100,
      readings: [reading(1, 85, "2026-07-28T09:00:00Z")],
    });
    expect(out).toMatchObject({ result: "validated", delta: 15 });
  });
});

describe("leverage (frozen formula)", () => {
  it("computes impact × confidence / cost with cost floor", () => {
    expect(leverage({ target_delta: 50, gap: 100, confidence: 0.5, cost_tokens: 0, cost_human_min: 0 })).toBe(0.25);
    expect(leverage({ target_delta: 30, gap: 100, confidence: 0.3, cost_tokens: 30000, cost_human_min: 10 })).toBeCloseTo(
      (0.3 * 0.3) / 40000,
    );
  });
  it("zero gap yields zero (not Infinity)", () => {
    expect(leverage({ target_delta: 10, gap: 0, confidence: 1, cost_tokens: 1, cost_human_min: 0 })).toBe(0);
  });
  it("ties break by id, stable", () => {
    expect(compareByLeverage({ leverage: 1, id: "H-b" }, { leverage: 1, id: "H-a" })).toBeGreaterThan(0);
  });
});

describe("stripe MRR contract", () => {
  const price = (unit: number, interval: string, extra: Record<string, unknown> = {}) => ({
    unit_amount: unit,
    currency: "usd",
    recurring: { interval, interval_count: 1, usage_type: "licensed", ...extra },
  });
  it("normalizes yearly to monthly, floors, integer minor units", () => {
    const { mrr_minor } = computeMrrMinor(
      [{ id: "s1", status: "active", items: { data: [{ quantity: 1, price: price(12000, "year") }] } }] as any,
      "usd",
    );
    expect(mrr_minor).toBe(1000);
  });
  it("excludes trialing/canceled and metered/tiered with journaled skips", () => {
    const { mrr_minor, skipped } = computeMrrMinor(
      [
        { id: "s1", status: "trialing", items: { data: [{ quantity: 1, price: price(5000, "month") }] } },
        { id: "s2", status: "active", items: { data: [{ quantity: 1, price: { ...price(5000, "month"), recurring: { interval: "month", interval_count: 1, usage_type: "metered" } } }] } },
        { id: "s3", status: "active", items: { data: [{ quantity: 2, price: price(1000, "month") }] } },
      ] as any,
      "usd",
    );
    expect(mrr_minor).toBe(2000);
    expect(skipped).toHaveLength(1);
  });
  it("skips foreign currency and journals it", () => {
    const { mrr_minor, skipped } = computeMrrMinor(
      [{ id: "s1", status: "active", items: { data: [{ quantity: 1, price: { ...price(5000, "month"), currency: "eur" } }] } }] as any,
      "usd",
    );
    expect(mrr_minor).toBe(0);
    expect(skipped[0]).toContain("currency");
  });
});

describe("hypothesis schema (invariant VII)", () => {
  const valid = {
    id: "H-20260713-test-bet",
    metric: "stars",
    claim: { summary: "do X on Y for +40 stars", target_delta: 40, unit: "stars" },
    economics: { cost_tokens: 1000, cost_human_min: 0, risk: "none", confidence: 0.4, confidence_source: "guess" },
    experiment: { duration_days: 14, channels: ["mock"], projects: [{ type: "content", channel: "mock", payload_type: "text", count: 1, brief: "x" }] },
    kill_criteria: { min_delta: 10, tripwires: [] },
  };
  it("accepts a valid bet", () => {
    expect(HypothesisSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a bet without kill criteria", () => {
    const { kill_criteria: _drop, ...rest } = valid;
    const res = HypothesisSchema.safeParse(rest);
    expect(res.success).toBe(false);
  });
  it("rejects min_delta of 0 — a bet that cannot lose is a vibe", () => {
    const res = HypothesisSchema.safeParse({ ...valid, kill_criteria: { min_delta: 0, tripwires: [] } });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.success ? "" : res.error.issues)).toContain("invariant VII");
  });
  it("rejects kill threshold above the claimed delta", () => {
    expect(HypothesisSchema.safeParse({ ...valid, kill_criteria: { min_delta: 50, tripwires: [] } }).success).toBe(false);
  });
});

describe("transition tables", () => {
  it("only a human crosses pending_approval → approved (invariant III)", () => {
    expect(() => assertContentTransition("C-1", "pending_approval", "approved", "core")).toThrowError(CronfounderError);
    expect(() => assertContentTransition("C-1", "pending_approval", "approved", "human")).not.toThrow();
  });
  it("draft can never jump straight to published", () => {
    expect(() => assertContentTransition("C-1", "draft", "published", "core")).toThrowError(/refused/);
  });
  it("verdicts come only from the verdict actor (invariant IX)", () => {
    expect(() => assertHypothesisTransition("H-1", "measuring", "validated", "human")).toThrowError(/verdict/);
    expect(() => assertHypothesisTransition("H-1", "measuring", "validated", "verdict")).not.toThrow();
  });
  it("resume from paused is human-only", () => {
    expect(() => assertHypothesisTransition("H-1", "paused", "measuring", "watchdog")).toThrowError(CronfounderError);
    expect(() => assertHypothesisTransition("H-1", "paused", "measuring", "human")).not.toThrow();
  });
});
