import { describe, expect, it } from "vitest";
import { Gatekeeper } from "../src/gatekeeper.js";
import { DEFAULT_CONFIG, type CueConfig, type SkillRecord } from "../src/types.js";

const tdd: SkillRecord = {
  name: "test-driven-development",
  path: "/fixtures/test-driven-development/SKILL.md",
  description: "Use when implementing any feature or bugfix",
  triggerPhrases: ["implementing any feature"],
  terms: ["test", "driven", "development"],
  mtimeMs: 1,
};

function gated(): CueConfig {
  return {
    ...DEFAULT_CONFIG,
    gates: { "test-driven-development": { tools: ["write", "edit"] } },
  };
}

describe("Gatekeeper", () => {
  it("does not block when no gates are configured", () => {
    expect(new Gatekeeper(DEFAULT_CONFIG, [tdd]).check("write")).toBeUndefined();
  });

  it("blocks a guarded tool while the gate is unsatisfied", () => {
    const result = new Gatekeeper(gated(), [tdd]).check("write");
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("test-driven-development");
    expect(result?.reason).toContain("/fixtures/test-driven-development/SKILL.md");
  });

  it("leaves unguarded tools alone", () => {
    expect(new Gatekeeper(gated(), [tdd]).check("read")).toBeUndefined();
  });

  it("stops blocking once the skill file is read", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/test-driven-development/SKILL.md");
    expect(keeper.check("write")).toBeUndefined();
  });

  it("accepts satisfaction by skill name for /skill: invocations", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.markSatisfied("test-driven-development");
    expect(keeper.check("write")).toBeUndefined();
  });

  it("ignores a read of an unrelated file", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/other/SKILL.md");
    expect(keeper.check("write")?.block).toBe(true);
  });

  it("releases on the third consecutive block of the same tool", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    expect(keeper.check("write")?.block).toBe(true);
    expect(keeper.check("write")?.block).toBe(true);
    expect(keeper.check("write")).toBeUndefined();
  });

  it("counts consecutive blocks per tool, not globally", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.check("write");
    keeper.check("write");
    expect(keeper.check("edit")?.block).toBe(true);
  });

  it("ignores a gate naming a skill that is not installed", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, gates: { absent: { tools: ["write"] } } };
    expect(new Gatekeeper(config, [tdd]).check("write")).toBeUndefined();
  });

  it("never gates a muted skill", () => {
    const config: CueConfig = { ...gated(), mute: ["test-driven-development"] };
    expect(new Gatekeeper(config, [tdd]).check("write")).toBeUndefined();
  });

  it("reports which skills have been read for injector dedupe", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/test-driven-development/SKILL.md");
    expect(keeper.readSkills()).toEqual(new Set(["test-driven-development"]));
  });
});
