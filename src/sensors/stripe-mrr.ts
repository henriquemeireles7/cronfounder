/**
 * Stripe MRR — the frozen contract (documented in docs/concepts.md#mrr):
 *   include: subscriptions with status == "active" (trialing/past_due/canceled/paused excluded)
 *   include: flat-rate priced items only; metered/tiered items are excluded
 *            and journaled as a sensor warning (never silently miscounted)
 *   monthly normalization: quantity × unit_amount / interval_in_months
 *     (year=12, month=1×interval_count, week≈12/52.18, day≈12/365.25 — computed
 *      as unit_amount × quantity × conversions, integer minor units, floor)
 *   currency: the single configured company currency; other currencies are
 *   skipped and journaled
 *   value reported in MAJOR units (e.g. dollars) with 2 decimals
 * Raw subscription payloads are discarded after extraction.
 */
import { CronfounderError, EXIT } from "../errors.js";
import { iso } from "../ids.js";
import type { Company } from "../core/company.js";
import { resolveCredential, type SensorDef, type SensorReading } from "./index.js";

interface StripeItem {
  quantity?: number;
  price?: {
    unit_amount?: number | null;
    currency?: string;
    recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null;
    billing_scheme?: string;
  };
}
interface StripeSub {
  id: string;
  status: string;
  items?: { data?: StripeItem[] };
}

export interface MrrComputation {
  mrr_minor: number;
  skipped: string[];
}

export function computeMrrMinor(subs: StripeSub[], currency: string): MrrComputation {
  const skipped: string[] = [];
  let total = 0;
  for (const sub of subs) {
    if (sub.status !== "active") continue;
    for (const item of sub.items?.data ?? []) {
      const price = item.price;
      if (!price?.recurring) continue;
      if (price.recurring.usage_type === "metered" || price.billing_scheme === "tiered") {
        skipped.push(`${sub.id}: metered/tiered price excluded from MRR`);
        continue;
      }
      if ((price.currency ?? "").toLowerCase() !== currency.toLowerCase()) {
        skipped.push(`${sub.id}: currency ${price.currency} ≠ company currency ${currency}, skipped`);
        continue;
      }
      const unit = price.unit_amount;
      if (typeof unit !== "number") {
        skipped.push(`${sub.id}: price has no unit_amount, skipped`);
        continue;
      }
      const qty = item.quantity ?? 1;
      const count = price.recurring.interval_count ?? 1;
      const perMonth: Record<string, number> = {
        month: 1 / count,
        year: 1 / (12 * count),
        week: 52.18 / (12 * count),
        day: 365.25 / (12 * count),
      };
      const factor = perMonth[price.recurring.interval ?? ""];
      if (factor === undefined) {
        skipped.push(`${sub.id}: unknown interval ${price.recurring.interval}, skipped`);
        continue;
      }
      total += Math.floor(unit * qty * factor);
    }
  }
  return { mrr_minor: total, skipped };
}

export async function readStripeMrr(company: Company, sensor: SensorDef): Promise<SensorReading> {
  const key = resolveCredential(sensor.credential_ref, "stripe_mrr");
  const base = process.env.CRONFOUNDER_STRIPE_API ?? "https://api.stripe.com";
  const subs: StripeSub[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ status: "active", limit: "100" });
    params.append("expand[]", "data.items.data.price");
    if (startingAfter) params.set("starting_after", startingAfter);
    let res: Response;
    try {
      res = await fetch(`${base}/v1/subscriptions?${params}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new CronfounderError({
        code: "E_SENSOR_NETWORK",
        exit: EXIT.ERROR,
        problem: "stripe_mrr: network failure reaching api.stripe.com",
        cause: e instanceof Error ? e.message : String(e),
        fix: "check connectivity and retry",
        retryable: true,
      });
    }
    if (res.status === 401) {
      throw new CronfounderError({
        code: "E_CREDENTIAL_REJECTED",
        exit: EXIT.ERROR,
        problem: "stripe_mrr: Stripe rejected the API key (401)",
        cause: `the key in $${sensor.credential_ref} is invalid, revoked, or lacks read access to subscriptions`,
        fix: "create a restricted key with Subscriptions: Read at https://dashboard.stripe.com/apikeys and update the env var",
      });
    }
    if (!res.ok) {
      throw new CronfounderError({
        code: "E_SENSOR_HTTP",
        exit: EXIT.ERROR,
        problem: `stripe_mrr: Stripe returned HTTP ${res.status}`,
        cause: (await res.text()).slice(0, 200),
        fix: "retry; if persistent, check https://status.stripe.com",
        retryable: true,
      });
    }
    const body = (await res.json()) as { data?: StripeSub[]; has_more?: boolean };
    subs.push(...(body.data ?? []));
    if (!body.has_more || subs.length === 0) break;
    startingAfter = subs[subs.length - 1]!.id;
  }
  const { mrr_minor } = computeMrrMinor(subs, company.config.currency);
  return { value: Math.round(mrr_minor) / 100, measured_at: iso() };
}
