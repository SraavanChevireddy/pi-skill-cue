import type { CueConfig, SkillRecord } from "./types.js";

export interface BlockDecision {
  block: true;
  reason: string;
  skill: string;
}

/** Consecutive blocks of the same tool before the gate releases, to avoid trapping the agent. */
const RELEASE_AFTER = 2;

/** Per-session gate state. One instance per pi session. */
export class Gatekeeper {
  private readonly satisfied = new Set<string>();
  private readonly consecutive = new Map<string, number>();
  private readonly byPath = new Map<string, string>();
  private readonly installed = new Map<string, SkillRecord>();

  constructor(
    private readonly config: CueConfig,
    records: SkillRecord[],
  ) {
    const muted = new Set(config.mute);
    for (const record of records) {
      if (muted.has(record.name)) continue;
      this.installed.set(record.name, record);
      this.byPath.set(record.path, record.name);
    }
  }

  /** Mark a skill satisfied by name, e.g. after a /skill:<name> invocation. */
  markSatisfied(name: string): void {
    this.satisfied.add(name);
  }

  /** Observe a read tool call; satisfies the gate when the path is a known SKILL.md. */
  noteRead(path: string): void {
    const name = this.byPath.get(path);
    if (name) this.satisfied.add(name);
  }

  /** Skills read this session, used by the injector to avoid repeat injections. */
  readSkills(): Set<string> {
    return new Set(this.satisfied);
  }

  /** Decide whether a tool call is blocked. Returns undefined to allow. */
  check(tool: string): BlockDecision | undefined {
    for (const [name, gate] of Object.entries(this.config.gates)) {
      if (!gate.tools.includes(tool)) continue;
      const record = this.installed.get(name);
      if (!record || this.satisfied.has(name)) continue;

      const key = `${name}:${tool}`;
      const seen = this.consecutive.get(key) ?? 0;
      if (seen >= RELEASE_AFTER) {
        this.consecutive.set(key, 0);
        continue;
      }
      this.consecutive.set(key, seen + 1);

      return {
        block: true,
        skill: name,
        reason: `Gated by pi-skill-cue: read the \`${name}\` skill at ${record.path} before using ${tool}. Run /cue off to disable gating for this session.`,
      };
    }
    return undefined;
  }
}
