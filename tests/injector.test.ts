import { describe, expect, it } from "vitest";
import { buildDirective, MAX_DIRECTIVE_CHARS } from "../src/injector.js";
import type { RankedMatch, SkillRecord } from "../src/types.js";

function match(name: string, detail = "some trigger phrase"): RankedMatch {
  const skill: SkillRecord = {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description: `Use when ${detail}`,
    triggerPhrases: [detail],
    terms: [name],
    mtimeMs: 1,
  };
  return { skill, score: 0.8, reasons: [{ kind: "trigger", detail }] };
}

describe("buildDirective", () => {
  it("returns undefined when there are no matches", () => {
    expect(buildDirective([], new Set())).toBeUndefined();
  });

  it("names the skill and its absolute path", () => {
    const text = buildDirective([match("alpha")], new Set());
    expect(text).toContain("`alpha`");
    expect(text).toContain("/fixtures/alpha/SKILL.md");
  });

  it("states the reason so a user can debug a bad match", () => {
    expect(buildDirective([match("alpha", "reviewing a pull request")], new Set()))
      .toContain("reviewing a pull request");
  });

  it("omits skills already read this session", () => {
    const text = buildDirective([match("alpha"), match("beta")], new Set(["alpha"]));
    expect(text).not.toContain("`alpha`");
    expect(text).toContain("`beta`");
  });

  it("returns undefined when every match was already read", () => {
    expect(buildDirective([match("alpha")], new Set(["alpha"]))).toBeUndefined();
  });

  it("drops the lowest-ranked matches when the budget is reached", () => {
    // Each line renders name and path, so a long name makes one line exceed a third of the budget.
    const wide = (name: string) => match(name.padEnd(160, "-"));
    const text = buildDirective([wide("alpha"), wide("beta"), wide("gamma")], new Set()) ?? "";

    expect(text.length).toBeLessThanOrEqual(MAX_DIRECTIVE_CHARS);
    expect(text).toContain("alpha");
    expect(text).not.toContain("gamma");
  });

  it("truncates an over-long reason rather than the match list", () => {
    const text = buildDirective([match("alpha", "x".repeat(400))], new Set()) ?? "";
    expect(text).toContain("...");
    expect(text.length).toBeLessThanOrEqual(MAX_DIRECTIVE_CHARS);
    expect(text).toContain("`alpha`");
  });

  it("preserves the ranking order it was given", () => {
    const text = buildDirective([match("beta"), match("alpha")], new Set()) ?? "";
    expect(text.indexOf("`beta`")).toBeLessThan(text.indexOf("`alpha`"));
  });

  it("falls back to a generic reason when a match carries none", () => {
    const bare: RankedMatch = { ...match("alpha"), reasons: [] };
    expect(buildDirective([bare], new Set())).toContain("lexical match");
  });
});
