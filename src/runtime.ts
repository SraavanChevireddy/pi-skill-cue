import { buildCatalog, type SkillInput } from "./catalog.js";
import { lintCatalog } from "./doctor.js";
import { Gatekeeper, type BlockDecision } from "./gatekeeper.js";
import { buildDirective } from "./injector.js";
import { Ledger } from "./ledger.js";
import { renderDoctor, renderReport } from "./report.js";
import { scoreSkills } from "./scorer.js";
import type { CueConfig, SkillRecord } from "./types.js";

export interface RuntimeOptions {
  config: CueConfig;
  ledgerDir: string;
  sessionId: string;
}

export interface PromptResult {
  directive: string;
  matched: string[];
}

/**
 * Session-scoped orchestration. Holds no pi types, so it is testable with plain objects.
 * Callers are responsible for catching nothing: every method here is already defensive.
 */
export class CueRuntime {
  private readonly ledger: Ledger;
  private records: SkillRecord[] = [];
  private gatekeeper: Gatekeeper | undefined;
  private enabled: boolean;
  private lastMatch: string | undefined;

  constructor(private readonly options: RuntimeOptions) {
    this.ledger = new Ledger(options.ledgerDir);
    this.enabled = options.config.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  lastMatchSummary(): string {
    return this.lastMatch ?? "no match yet this session";
  }

  /** Called on each user prompt. Returns the directive to append, or undefined to leave the turn untouched. */
  onPrompt(prompt: string, skills: SkillInput[], cwdExtensions: string[]): PromptResult | undefined {
    try {
      if (!this.enabled) return undefined;

      this.records = buildCatalog(skills);
      if (!this.gatekeeper) this.gatekeeper = new Gatekeeper(this.options.config, this.records);
      if (this.records.length === 0) return undefined;

      const matches = scoreSkills(this.records, { prompt, cwdExtensions }, this.options.config);
      const directive = buildDirective(matches, this.gatekeeper.satisfiedSkills());
      if (!directive) return undefined;

      for (const match of matches) {
        this.ledger.append({
          type: "inject",
          ts: Date.now(),
          session: this.options.sessionId,
          skill: match.skill.name,
          score: match.score,
          reason: match.reasons[0]?.detail ?? "",
        });
      }

      this.lastMatch = matches
        .map((m) => `${m.skill.name} (${m.score.toFixed(2)}, ${m.reasons[0]?.kind ?? "terms"})`)
        .join("; ");

      return { directive, matched: matches.map((m) => m.skill.name) };
    } catch (error) {
      this.noteError("onPrompt", error);
      return undefined;
    }
  }

  /** Called before a tool executes. Returns a block decision, or undefined to allow. */
  onToolCall(tool: string, input: { path?: string }): BlockDecision | undefined {
    try {
      if (!this.enabled || !this.gatekeeper) return undefined;

      if (tool === "read" && typeof input.path === "string") {
        const before = this.gatekeeper.satisfiedSkills();
        this.gatekeeper.noteRead(input.path);
        for (const name of this.gatekeeper.satisfiedSkills()) {
          if (before.has(name)) continue;
          this.ledger.append({ type: "read", ts: Date.now(), session: this.options.sessionId, skill: name });
        }
        return undefined;
      }

      const decision = this.gatekeeper.check(tool);
      if (decision) {
        this.ledger.append({
          type: "block",
          ts: Date.now(),
          session: this.options.sessionId,
          skill: decision.skill,
          tool,
        });
      }
      return decision;
    } catch (error) {
      this.noteError("onToolCall", error);
      return undefined;
    }
  }

  /** Satisfy a gate from a /skill:<name> invocation. */
  markSkillUsed(name: string): void {
    try {
      this.gatekeeper?.markSatisfied(name);
    } catch (error) {
      this.noteError("markSkillUsed", error);
    }
  }

  report(): string {
    try {
      return renderReport(this.records, this.ledger.stats());
    } catch (error) {
      this.noteError("report", error);
      return "Report unavailable.";
    }
  }

  doctor(): string {
    try {
      return renderDoctor(lintCatalog(this.records, this.ledger.stats()));
    } catch (error) {
      this.noteError("doctor", error);
      return "Doctor unavailable.";
    }
  }

  purge(): void {
    this.ledger.purge();
  }

  private noteError(where: string, error: unknown): void {
    this.ledger.append({
      type: "error",
      ts: Date.now(),
      session: this.options.sessionId,
      where,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
