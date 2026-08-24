/** A skill normalised for routing. */
export interface SkillRecord {
  /** Skill name as pi reports it. */
  name: string;
  /** Absolute path to the skill's SKILL.md. */
  path: string;
  description: string;
  /** Phrases extracted from "use when ..." clauses in the description. */
  triggerPhrases: string[];
  /** Normalised tokens from name + description, deduplicated. */
  terms: string[];
  /** mtime of SKILL.md in ms, used for cache invalidation. */
  mtimeMs: number;
}

/**
 * Why a skill matched.
 * - "trigger": a "use when ..." phrase from the skill's own description matched.
 * - "regex":   a user-configured regex from config.triggers matched.
 * - "terms":   IDF-weighted term overlap between prompt and skill.
 * - "context": a signal from the working directory matched.
 */
export type MatchReasonKind = "trigger" | "regex" | "terms" | "context";

export interface MatchReason {
  kind: MatchReasonKind;
  detail: string;
}

export interface RankedMatch {
  skill: SkillRecord;
  /** Normalised 0..1. */
  score: number;
  reasons: MatchReason[];
}

export interface ScoreSignals {
  prompt: string;
  /** File extensions present in cwd, without the dot, e.g. ["ts", "md"]. */
  cwdExtensions: string[];
}

export interface GateConfig {
  tools: string[];
}

export interface CueConfig {
  enabled: boolean;
  maxSkills: number;
  /** Minimum normalised score required to inject. */
  threshold: number;
  /** When true, the injected directive is also shown as a session message. */
  verbose: boolean;
  /** Skill names never injected and never gated. */
  mute: string[];
  /** Skill name → regex source strings that force a match. */
  triggers: Record<string, string[]>;
  /** Skill name → gate configuration. */
  gates: Record<string, GateConfig>;
  escalate: EscalateConfig;
}

export interface EscalateConfig {
  enabled: boolean;
  /** Model id to consult, or null to use the session's active model. */
  model: string | null;
}

export function createDefaultConfig(): CueConfig {
  return {
    enabled: true,
    maxSkills: 3,
    threshold: 0.35,
    verbose: false,
    mute: [],
    triggers: {},
    gates: {},
    escalate: { enabled: false, model: null },
  };
}

/** Convenience snapshot for reads and assertions. Never mutate it; call createDefaultConfig() to own a copy. */
export const DEFAULT_CONFIG: CueConfig = createDefaultConfig();

export type LedgerEvent =
  | {
      type: "inject";
      ts: number;
      session: string;
      skill: string;
      score: number;
      /** `detail` of the highest-weighted MatchReason for this injection, e.g. the matched "use when" phrase. */
      reason: string;
    }
  | { type: "read"; ts: number; session: string; skill: string }
  | { type: "block"; ts: number; session: string; skill: string; tool: string }
  | { type: "error"; ts: number; session: string; where: string; message: string };

export interface SkillStats {
  injections: number;
  reads: number;
  blocks: number;
}
