import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "cue-ledger-"));
}

describe("Ledger", () => {
  it("round-trips appended events", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "inject", ts: 1, session: "s1", skill: "alpha", score: 0.8, reason: "trigger" });
    ledger.append({ type: "read", ts: 2, session: "s1", skill: "alpha" });
    const events = ledger.read();
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("inject");
  });

  it("aggregates per-skill stats", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "inject", ts: 1, session: "s1", skill: "alpha", score: 0.8, reason: "t" });
    ledger.append({ type: "inject", ts: 2, session: "s1", skill: "alpha", score: 0.7, reason: "t" });
    ledger.append({ type: "read", ts: 3, session: "s1", skill: "alpha" });
    ledger.append({ type: "block", ts: 4, session: "s1", skill: "beta", tool: "write" });
    const stats = ledger.stats();
    expect(stats.get("alpha")).toEqual({ injections: 2, reads: 1, blocks: 0 });
    expect(stats.get("beta")).toEqual({ injections: 0, reads: 0, blocks: 1 });
  });

  it("skips malformed lines instead of throwing", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    appendFileSync(ledger.file, "{ not json\n", "utf8");
    expect(ledger.read()).toHaveLength(1);
  });

  it("drops a line missing the field its aggregator reads", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    appendFileSync(ledger.file, `${JSON.stringify({ type: "read", ts: 2 })}\n`, "utf8");
    expect(ledger.read()).toHaveLength(1);
    expect([...ledger.stats().keys()]).toEqual(["alpha"]);
  });

  it("drops a line whose type is not a known event", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    appendFileSync(ledger.file, `${JSON.stringify({ type: "nonsense", skill: "alpha" })}\n`, "utf8");
    expect(ledger.read()).toHaveLength(1);
  });

  it("purges the log file", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    expect(existsSync(ledger.file)).toBe(true);
    ledger.purge();
    expect(existsSync(ledger.file)).toBe(false);
    expect(ledger.read()).toEqual([]);
  });

  it("swallows write failures so routing is never interrupted", () => {
    const blocker = join(dir(), "not-a-directory");
    writeFileSync(blocker, "");
    const ledger = new Ledger(blocker);
    expect(() => ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" })).not.toThrow();
    expect(ledger.read()).toEqual([]);
  });

  it("returns an empty list when the log does not exist yet", () => {
    expect(new Ledger(dir()).read()).toEqual([]);
  });
});
