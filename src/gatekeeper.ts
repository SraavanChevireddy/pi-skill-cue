import { resolve } from "node:path";
import type { CueConfig, SkillRecord } from "./types.js";

export interface BlockDecision {
  block: true;
  reason: string;
  skill: string;
}

/**
 * Blocks of one tool by one gate before that gate gives up for the rest of the session.
 * Releasing permanently is deliberate: a gate is a nudge with teeth, not a security control, and
 * an agent that can be blocked indefinitely burns tokens and user trust. Note the cost is per
 * gate, so two unsatisfied gates on the same tool can block it this many times each.
 */
const RELEASE_AFTER = 2;

/** Composite key for the per-gate, per-tool block counter. */
function gateKey(skill: string, tool: string): string {
  return `${skill}\u0000${tool}`;
}

/** Per-session gate state. One instance per pi session. */
export class Gatekeeper {
  private readonly satisfied = new Set<string>();
  private readonly blocksByGateTool = new Map<string, number>();
  private readonly byResolvedPath = new Map<string, string>();
  /** Skills eligible to gate: installed, and not muted. */
  private readonly gateable = new Map<string, SkillRecord>();

  constructor(
    private readonly config: CueConfig,
    records: SkillRecord[],
  ) {
    const muted = new Set(config.mute);
    for (const record of records) {
      if (muted.has(record.name)) continue;
      this.gateable.set(record.name, record);
      this.byResolvedPath.set(resolve(record.path), record.name);
    }
  }

  /** Mark a skill satisfied by name, e.g. after a /skill:<name> invocation. */
  markSatisfied(name: string): void {
    this.satisfied.add(name);
  }

  /**
   * Observe a read tool call. Paths are resolved on both sides so a relative path satisfies the
   * gate. Only the SKILL.md itself counts: reading a skill's reference file is not reading the skill.
   */
  noteRead(path: string): void {
    const name = this.byResolvedPath.get(resolve(path));
    if (name) this.satisfied.add(name);
  }

  /**
   * Skills that no longer need injecting or gating this session, whether satisfied by a read or by
   * an explicit /skill: invocation. The injector uses this to avoid repeating itself.
   */
  satisfiedSkills(): Set<string> {
    return new Set(this.satisfied);
  }

  /**
   * Decide whether a tool call is blocked. Returns undefined to allow.
   * When several gates guard the same tool, the first one in config order wins.
   */
  check(tool: string): BlockDecision | undefined {
    if (!this.config.enabled) return undefined;

    for (const [name, gate] of Object.entries(this.config.gates)) {
      if (!gate.tools.includes(tool)) continue;
      const record = this.gateable.get(name);
      if (!record || this.satisfied.has(name)) continue;

      const key = gateKey(name, tool);
      const blocks = this.blocksByGateTool.get(key) ?? 0;
      if (blocks >= RELEASE_AFTER) {
        // Give up permanently rather than resetting the counter, which would re-arm the trap.
        this.satisfied.add(name);
        continue;
      }
      this.blocksByGateTool.set(key, blocks + 1);

      return {
        block: true,
        skill: name,
        reason: `Gated by pi-skill-cue: read the \`${name}\` skill at ${record.path} before using ${tool}. Run /cue off to disable gating for this session.`,
      };
    }

    return undefined;
  }
}
