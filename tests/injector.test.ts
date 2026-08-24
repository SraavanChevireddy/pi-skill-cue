import { describe, expect, it } from "vitest";
import { buildDirective, MAX_DIRECTIVE_CHARS } from "../src/injector.js";
import type { RankedMatch, SkillRecord } from "../src/types.js";

function match(name: string, score: number, detail = "some trigger phrase"): RankedMatch {
  const skill: SkillRecord = {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description: `Use when ${detail}`,
    triggerPhrases: [detail],
    terms: [name],
    mtimeMs: 1,
  };
  return { skill, score, reasons: [{ kind: "trigger", detail }] };
}

describe("buildDirective", () => {
  it("returns undefined when there are no matches", () => {
    expect(buildDirective([], new Set())).toBeUndefined();
  });

  it("names the skill and its absolute path", () => {
    const text = buildDirective([match("alpha", 0.8)], new Set());
    expect(text).toContain("`alpha`");
    expect(text).toContain("/fixtures/alpha/SKILL.md");
  });

  it("states the reason so a user can debug a bad match", () => {
    expect(buildDirective([match("alpha", 0.8, "reviewing a pull request")], new Set()))
      .toContain("reviewing a pull request");
  });

  it("omits skills already read this session", () => {
    const text = buildDirective([match("alpha", 0.9), match("beta", 0.8)], new Set(["alpha"]));
    expect(text).not.toContain("`alpha`");
    expect(text).toContain("`beta`");
  });

  it("returns undefined when every match was already read", () => {
    expect(buildDirective([match("alpha", 0.9)], new Set(["alpha"]))).toBeUndefined();
  });

  it("stays within the character budget", () => {
    const many = ["alpha", "beta", "gamma"].map((n) => match(n, 0.9, "x".repeat(400)));
    const text = buildDirective(many, new Set()) ?? "";
    expect(text.length).toBeLessThanOrEqual(MAX_DIRECTIVE_CHARS);
    expect(text).toContain("`alpha`");
  });
});
