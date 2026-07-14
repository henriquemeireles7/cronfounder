/**
 * Hats — role prompt + tool allowlist + import table. The runtime never
 * chooses its own permissions (spec /18): the invoking command selects the
 * hat; the staging importer accepts only that hat's artifact kinds.
 *
 * Enforcement is layered: allowlists constrain tools, but the real boundary
 * is the import table + schema validation + mirror repair. The most
 * intelligent actor (strategist) has the richest read harness and zero
 * side-effect reach — it can only propose files that the core may refuse.
 */
export type HatName = "planner" | "strategist" | "content_builder" | "channel_builder" | "onboarding" | "narrator";

export interface Hat {
  name: HatName;
  /** claude CLI tool allowlist (--allowedTools) */
  allowedTools: string[];
  /** artifact kinds the staging importer will accept from this hat */
  imports: Array<"hypothesis" | "content" | "channel_setup" | "doctrine_draft" | "narration">;
  maxTurns: number;
}

export const HATS: Record<HatName, Hat> = {
  planner: {
    name: "planner",
    allowedTools: ["Read", "Grep", "Glob"],
    imports: ["narration"],
    maxTurns: 10,
  },
  strategist: {
    name: "strategist",
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write"],
    imports: ["hypothesis"],
    maxTurns: 40,
  },
  content_builder: {
    name: "content_builder",
    allowedTools: ["Read", "Grep", "Glob", "Write"],
    imports: ["content"],
    maxTurns: 30,
  },
  channel_builder: {
    name: "channel_builder",
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write"],
    imports: ["channel_setup"],
    maxTurns: 30,
  },
  onboarding: {
    name: "onboarding",
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write"],
    imports: ["doctrine_draft"],
    maxTurns: 40,
  },
  narrator: {
    name: "narrator",
    allowedTools: ["Read"],
    imports: ["narration"],
    maxTurns: 5,
  },
};
