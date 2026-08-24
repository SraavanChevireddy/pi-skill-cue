import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEvent, SkillStats } from "./types.js";

/** Append-only local event log. Every method swallows its own errors: telemetry never breaks routing. */
export class Ledger {
  readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "events.jsonl");
  }

  append(event: LedgerEvent): void {
    this.appendRaw(`${JSON.stringify(event)}\n`);
  }

  /** Exposed for tests that need to write a malformed line. */
  appendRaw(line: string): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file, line, "utf8");
    } catch {
      // Intentionally ignored.
    }
  }

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
        const parsed = JSON.parse(line) as LedgerEvent;
        if (typeof parsed?.type === "string") events.push(parsed);
      } catch {
        continue;
      }
    }
    return events;
  }

  stats(): Map<string, SkillStats> {
    const stats = new Map<string, SkillStats>();
    const bump = (skill: string): SkillStats => {
      let entry = stats.get(skill);
      if (!entry) {
        entry = { injections: 0, reads: 0, blocks: 0 };
        stats.set(skill, entry);
      }
      return entry;
    };

    for (const event of this.read()) {
      if (event.type === "error") continue;
      const entry = bump(event.skill);
      if (event.type === "inject") entry.injections += 1;
      else if (event.type === "read") entry.reads += 1;
      else if (event.type === "block") entry.blocks += 1;
    }
    return stats;
  }

  purge(): void {
    try {
      rmSync(this.file, { force: true });
    } catch {
      // Intentionally ignored.
    }
  }
}
