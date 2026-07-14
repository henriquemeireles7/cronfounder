/**
 * Document schemas — the contract between agents (who draft files) and the
 * deterministic core (which refuses anything invalid, with the reason).
 *
 * Authority split per field:
 *   HUMAN/AGENT-owned — prose and intent fields; files are canon.
 *   MACHINE-owned     — mirrors of ledger state; the core rewrites them and
 *                       reverts hand edits (like sense overwrites status).
 */
import { z } from "zod";
import { HYP_ID_RE, SLUG_RE } from "../ids.js";

const isoString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/, "must be an ISO-8601 UTC string (quote it in YAML)");

// ---------------------------------------------------------------- metric ---
export const MetricSchema = z.object({
  name: z.string().regex(SLUG_RE, "metric name must be a slug: lowercase letters, digits, _ or -"),
  parent: z.string().regex(SLUG_RE).nullable().default(null),
  unit: z.string().min(1),
  direction: z.enum(["increase", "decrease"]),
  sensor: z.object({
    type: z.enum(["github_stars", "stripe_mrr", "x_post_metrics", "mock"]),
    repo: z.string().optional(), // github_stars: owner/name
    credential_ref: z.string().optional(), // env var NAME, never a secret
    channel: z.string().optional(), // mock: which channel's state file
    content: z.string().optional(), // x_post_metrics: published cronfounder content id
    field: z
      .enum(["impression_count", "like_count", "retweet_count", "reply_count", "quote_count", "bookmark_count"])
      .optional(),
  }),
  spec: z
    .object({
      target: z.number(),
      deadline: isoString,
      set_by: z.string().min(1),
      set_at: isoString,
      baseline_value: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
  // MACHINE-owned mirror (sensors only — invariant I)
  status: z
    .object({
      value: z.number(),
      measured_at: isoString,
      written_by: z.string(),
    })
    .nullable()
    .default(null),
});
export type Metric = z.infer<typeof MetricSchema>;
export const METRIC_MACHINE_FIELDS = ["status"];

// ------------------------------------------------------------ hypothesis ---
export const HYPOTHESIS_STATES = [
  "proposed",
  "prioritized",
  "blocked",
  "active",
  "measuring",
  "validated",
  "invalidated",
  "paused",
] as const;
export type HypothesisState = (typeof HYPOTHESIS_STATES)[number];

export const TripwireSchema = z.object({
  source: z.string().regex(SLUG_RE), // channel id
  signal: z.enum(["negative_replies", "unsubscribes", "platform_flags", "deletions", "custom"]),
  aggregation: z.enum(["count", "sum", "max"]).default("count"),
  comparator: z.enum([">", ">="]).default(">="),
  threshold: z.number(),
  window_minutes: z.number().int().positive().default(60),
  min_samples: z.number().int().nonnegative().default(0),
  missing_policy: z.enum(["ignore", "trip"]).default("ignore"),
});

export const ProjectSpecSchema = z.object({
  type: z.enum(["content", "channel_setup"]),
  channel: z.string().regex(SLUG_RE),
  payload_type: z.enum(["text", "image", "video", "html"]).default("text"),
  count: z.number().int().positive().max(20).default(1),
  brief: z.string().min(1),
});

export const HypothesisSchema = z
  .object({
    id: z.string().regex(HYP_ID_RE, "hypothesis id must match H-YYYYMMDD-slug"),
    metric: z.string().regex(SLUG_RE),
    playbook: z.string().regex(SLUG_RE).nullable().default(null),
    claim: z.object({
      summary: z.string().min(10, "claim.summary must be one falsifiable sentence"),
      target_delta: z.number(),
      unit: z.string().min(1),
    }),
    economics: z.object({
      cost_tokens: z.number().int().nonnegative(),
      cost_human_min: z.number().int().nonnegative(),
      risk: z.enum(["none", "reversible", "irreversible"]),
      confidence: z.number().min(0).max(1),
      confidence_source: z.enum(["journal", "doctrine", "guess"]),
    }),
    experiment: z.object({
      duration_days: z.number().int().min(1).max(60),
      channels: z.array(z.string().regex(SLUG_RE)).min(1),
      projects: z.array(ProjectSpecSchema).min(1),
    }),
    // invariant VII: a bet that cannot lose is not a bet. The schema refuses it.
    kill_criteria: z.object({
      min_delta: z.number(),
      tripwires: z.array(TripwireSchema).default([]),
    }),
    // MACHINE-owned mirrors below
    state: z.enum(HYPOTHESIS_STATES).default("proposed"),
    disposition: z.enum(["open", "rejected", "closed_inconclusive"]).default("open"),
    review_at: isoString.nullable().default(null),
    activated_at: isoString.nullable().default(null),
    baseline: z
      .object({ value: z.number(), measured_at: isoString, reading_id: z.number().int() })
      .nullable()
      .default(null),
    verdict: z
      .object({
        result: z.enum(["validated", "invalidated"]),
        delta: z.number(),
        decided_at: isoString,
        algorithm_v: z.number().int(),
      })
      .nullable()
      .default(null),
  })
  .superRefine((h, ctx) => {
    if (h.kill_criteria.min_delta === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kill_criteria", "min_delta"],
        message:
          "kill_criteria.min_delta of 0 means the bet validates on any movement — set the smallest delta that would justify the cost (invariant VII)",
      });
    }
    if (Math.abs(h.kill_criteria.min_delta) > Math.abs(h.claim.target_delta)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kill_criteria", "min_delta"],
        message: "kill threshold cannot exceed the claimed delta — the bet could hit its claim and still be 'invalidated'",
      });
    }
  });
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export const HYPOTHESIS_MACHINE_FIELDS = ["state", "disposition", "review_at", "activated_at", "baseline", "verdict"];

// --------------------------------------------------------------- channel ---
export const ChannelSetupSchema = z.object({
  id: z.string().regex(SLUG_RE),
  kind: z.enum(["x", "mock"]),
  identity_owner: z.string().min(1), // the human; agents operate, never own (invariant IV)
  credential_ref: z.string().nullable().default(null), // env var NAME only
  acceptance: z.array(z.enum(["text", "image", "video", "html"])).min(1),
  capabilities: z.array(z.enum(["pull", "push", "subscribe"])).min(1),
  cadence: z.object({ max_per_day: z.number().int().positive().default(3) }),
  driver_ref: z.string().nullable().default(null), // key into .cronfounder/config.json drivers (human-owned)
  // MACHINE-owned mirror: computed readiness (credential resolvable + driver probe)
  readiness: z
    .object({ ready: z.boolean(), missing: z.array(z.string()), checked_at: isoString })
    .nullable()
    .default(null),
});
export type ChannelSetup = z.infer<typeof ChannelSetupSchema>;
export const CHANNEL_MACHINE_FIELDS = ["readiness"];

// --------------------------------------------------------------- content ---
export const CONTENT_STATES = ["draft", "pending_approval", "approved", "published"] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

export const ContentMetaSchema = z.object({
  id: z.string().regex(/^C-\d{8}-[a-z0-9][a-z0-9-]{0,48}$/),
  channel: z.string().regex(SLUG_RE),
  payload_type: z.enum(["text", "image", "video", "html"]),
  payload_file: z.string().min(1),
  provenance: z.object({
    task: z.number().int(),
    project: z.number().int(),
    hypothesis: z.string().regex(HYP_ID_RE),
    metric: z.string().regex(SLUG_RE),
  }),
  // MACHINE-owned mirror
  state: z.enum(CONTENT_STATES).default("draft"),
});
export type ContentMeta = z.infer<typeof ContentMetaSchema>;
export const CONTENT_MACHINE_FIELDS = ["state"];

// -------------------------------------------------------------- playbook ---
export const AUTONOMY_LEVELS = ["manual", "draft_only", "scheduled_with_approval", "auto"] as const;
export const PlaybookSchema = z.object({
  name: z.string().regex(SLUG_RE),
  // HUMAN-owned: autonomy is granted by the human (invariant III's ramp).
  autonomy: z.enum(AUTONOMY_LEVELS).default("manual"),
  channels: z.array(z.string().regex(SLUG_RE)).default([]),
  // MACHINE-owned: appended by verdicts.
  track_record: z
    .object({ validated: z.number().int(), invalidated: z.number().int(), last_verdict_at: isoString.nullable() })
    .nullable()
    .default(null),
});
export type Playbook = z.infer<typeof PlaybookSchema>;
export const PLAYBOOK_MACHINE_FIELDS = ["track_record"];

// ---------------------------------------------------------- constitution ---
export const ConstitutionSchema = z.object({
  auto_activation: z
    .object({
      // Default 0: the green lane is OFF until a human sets a budget.
      budget_tokens: z.number().int().nonnegative().default(0),
    })
    .default({ budget_tokens: 0 }),
  never_without_approval: z.array(z.string()).default([]),
});
export type Constitution = z.infer<typeof ConstitutionSchema>;

// ------------------------------------------------------------------ inbox ---
export const INBOX_KINDS = [
  "approve_hypothesis",
  "approve_content",
  "setup_channel",
  "provide_credential",
  "decide",
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Format a zod error into problem+fix naming file, field and expectation. */
export function schemaProblem(file: string, err: z.ZodError): { problem: string; fix: string } {
  const issue = err.issues[0]!;
  const fieldPath = issue.path.join(".") || "(root)";
  return {
    problem: `${file}: field "${fieldPath}" — ${issue.message}`,
    fix: `edit ${file} and fix "${fieldPath}"; the full field reference is in docs/concepts.md#schemas`,
  };
}
