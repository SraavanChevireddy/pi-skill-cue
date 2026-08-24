import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEvent, SkillStats } from "./types.js";

/** On-disk name of the active log. Named here so purge and any tooling agree on one contract. */
export const LEDGER_FILENAME = "events.jsonl";
/** Name of the single retained previous log. */
export const LEDGER_PREVIOUS_FILENAME = "events.1.jsonl";
/**
 * Rotate once the active log passes this size. A matched prompt writes up to three lines, so a
 * daily driver would otherwise grow this file forever and every report would re-read all of it.
 */
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;

const KNOWN_TYPES = new Set<LedgerEvent["type"]>(["inject", "read", "block", "error"]);

/**
 * A line is only an event if it carries a known type and the field its aggregator reads. A
 * half-written or hand-edited line would otherwise reach stats() and appear there as a skill
 * literally named "undefined".
 */
function isEvent(value: unknown): value is LedgerEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as { type?: unknown; skill?: unknown; where?: unknown };
  if (!KNOWN_TYPES.has(event.type as LedgerEvent["type"])) return false;
  return event.type === "error" ? typeof event.where === "string" : typeof event.skill === "string";
}

/** Append-only local event log. Every method swallows its own errors: telemetry never breaks routing. */
export class Ledger {
  readonly file: string;
  private readonly previousFile: string;
  private dirReady = false;

  constructor(private readonly dir: string) {
    this.file = join(dir, LEDGER_FILENAME);
    this.previousFile = join(dir, LEDGER_PREVIOUS_FILENAME);
  }

  append(event: LedgerEvent): void {
    try {
      if (!this.dirReady) {
        mkdirSync(this.dir, { recursive: true });
        this.dirReady = true;
      }
      this.rotateIfLarge();
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // Intentionally ignored.
    }
  }

  /** Reads the active log only, so reports describe recent activity rather than all history. */
  read(): LedgerEvent[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }

    const events: LedgerEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isEvent(parsed)) events.push(parsed);
      } catch {
        continue;
      }
    }
    return events;
  }

  stats(): Map<string, SkillStats> {
    const stats = new Map<string, SkillStats>();
    const statsFor = (skill: string): SkillStats => {
      let entry = stats.get(skill);
      if (!entry) {
        entry = { injections: 0, reads: 0, blocks: 0 };
        stats.set(skill, entry);
      }
      return entry;
    };

    for (const event of this.read()) {
      if (event.type === "error") continue;
      const entry = statsFor(event.skill);
      if (event.type === "inject") entry.injections += 1;
      else if (event.type === "read") entry.reads += 1;
      else if (event.type === "block") entry.blocks += 1;
    }
    return stats;
  }

  /** Removes both the active log and the retained previous one. */
  purge(): void {
    try {
      rmSync(this.file, { force: true });
      rmSync(this.previousFile, { force: true });
    } catch {
      // Intentionally ignored.
    }
  }

  private rotateIfLarge(): void {
    try {
      if (statSync(this.file).size < MAX_LEDGER_BYTES) return;
      renameSync(this.file, this.previousFile);
    } catch {
      // No active log yet, or the rename failed; either way appending is still correct.
    }
  }
}
