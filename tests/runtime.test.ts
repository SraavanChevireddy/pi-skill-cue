import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CueRuntime } from "../src/runtime.js";
import { DEFAULT_CONFIG, type CueConfig } from "../src/types.js";

function skill(name: string, description: string): { name: string; path: string; description: string } {
  const root = mkdtempSync(join(tmpdir(), "cue-runtime-"));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n`);
  return { name, path, description };
}

function runtime(config: CueConfig = DEFAULT_CONFIG) {
  const ledgerDir = mkdtempSync(join(tmpdir(), "cue-runtime-ledger-"));
  return new CueRuntime({ config, ledgerDir, sessionId: "s1" });
}

describe("CueRuntime.onPrompt", () => {
  it("returns a directive naming the matched skill", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const result = runtime().onPrompt("implementing a new feature for the parser", [tdd], []);
    expect(result?.directive).toContain("test-driven-development");
  });

  it("returns undefined when nothing matches", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    expect(runtime().onPrompt("what is the weather", [tdd], [])).toBeUndefined();
  });

  it("returns undefined when disabled", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime({ ...DEFAULT_CONFIG, enabled: false });
    expect(rt.onPrompt("implementing any feature", [tdd], [])).toBeUndefined();
  });

  it("does not inject the same skill twice in a session", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime();
    expect(rt.onPrompt("implementing any feature", [tdd], [])).toBeDefined();
    rt.onToolCall("read", { path: tdd.path });
    expect(rt.onPrompt("implementing any feature", [tdd], [])).toBeUndefined();
  });

  it("survives a malformed skill list without throwing", () => {
    expect(() => runtime().onPrompt("anything", [{ name: "x", path: "/nope/SKILL.md" }], [])).not.toThrow();
  });
});

describe("CueRuntime.onToolCall", () => {
  it("blocks a guarded tool until the gate is satisfied", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime({ ...DEFAULT_CONFIG, gates: { "test-driven-development": { tools: ["write"] } } });
    rt.onPrompt("implementing any feature", [tdd], []);
    expect(rt.onToolCall("write", { path: "/tmp/out.ts" })?.block).toBe(true);
    rt.onToolCall("read", { path: tdd.path });
    expect(rt.onToolCall("write", { path: "/tmp/out.ts" })).toBeUndefined();
  });

  it("never blocks before the catalogue is known", () => {
    const rt = runtime({ ...DEFAULT_CONFIG, gates: { "test-driven-development": { tools: ["write"] } } });
    expect(rt.onToolCall("write", { path: "/tmp/out.ts" })).toBeUndefined();
  });
});

describe("CueRuntime reporting", () => {
  it("records injections in the ledger and surfaces them in the report", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime();
    rt.onPrompt("implementing any feature", [tdd], []);
    expect(rt.report()).toContain("test-driven-development");
  });

  it("purges the ledger on request", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime();
    rt.onPrompt("implementing any feature", [tdd], []);
    rt.purge();
    expect(rt.report()).toContain("0");
  });
});
