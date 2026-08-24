import { describe, expect, it } from "vitest";
import { scoreSkills } from "../src/scorer.js";
import { extractTriggerPhrases, tokenize } from "../src/text.js";
import { DEFAULT_CONFIG, type CueConfig, type SkillRecord } from "../src/types.js";

function record(name: string, description: string): SkillRecord {
  return {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description,
    triggerPhrases: [],
    terms: [],
    mtimeMs: 1,
  };
}

/** Mirrors what buildCatalog derives, kept local so the scorer test needs no filesystem. */
function withDerived(r: SkillRecord): SkillRecord {
  return {
    ...r,
    triggerPhrases: extractTriggerPhrases(r.description),
    terms: [...new Set(tokenize(`${r.name} ${r.description}`))],
  };
}

const catalog: SkillRecord[] = [
  record("systematic-debugging", "Use when encountering a failing test or unexpected behaviour, before proposing fixes"),
  record("banner-design", "Use when designing banners for social media, ads, or website heroes"),
  record("ticket-workflow", "Use when the user references a tracked work item by key"),
].map(withDerived);

const signals = (prompt: string) => ({ prompt, cwdExtensions: [] as string[] });

describe("scoreSkills", () => {
  it("ranks a trigger-phrase match above unrelated skills", () => {
    const matches = scoreSkills(catalog, signals("I have a failing test and no idea why"), DEFAULT_CONFIG);
    expect(matches[0]?.skill.name).toBe("systematic-debugging");
    expect(matches[0]?.reasons.some((r) => r.kind === "trigger")).toBe(true);
  });

  it("normalises every score into 0..1", () => {
    for (const match of scoreSkills(catalog, signals("designing banners for ads"), DEFAULT_CONFIG)) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns nothing when no skill clears the threshold", () => {
    expect(scoreSkills(catalog, signals("what time is it"), DEFAULT_CONFIG)).toEqual([]);
  });

  it("lets a configured regex trigger outrank lexical similarity", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, triggers: { "ticket-workflow": ["\\b[A-Z]{2,}-\\d{3,}\\b"] } };
    const matches = scoreSkills(catalog, signals("take a look at ABC-1234 please"), config);
    expect(matches[0]?.skill.name).toBe("ticket-workflow");
    expect(matches[0]?.score).toBeGreaterThan(0.9);
    expect(matches[0]?.reasons.some((r) => r.kind === "regex")).toBe(true);
  });

  it("honours maxSkills", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, maxSkills: 1, threshold: 0.01 };
    expect(scoreSkills(catalog, signals("failing test while designing banners"), config)).toHaveLength(1);
  });

  it("never returns a muted skill", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, mute: ["systematic-debugging"] };
    const names = scoreSkills(catalog, signals("I have a failing test"), config).map((m) => m.skill.name);
    expect(names).not.toContain("systematic-debugging");
  });

  it("weights rare terms above terms common to the whole catalogue", () => {
    const shared = [
      record("alpha", "Use when handling widget calibration routines"),
      record("beta", "Use when handling widget shipping logistics"),
    ].map(withDerived);
    const matches = scoreSkills(shared, signals("calibration of a widget"), { ...DEFAULT_CONFIG, threshold: 0.01 });
    expect(matches[0]?.skill.name).toBe("alpha");
  });

  it("is deterministic across repeated calls", () => {
    const a = scoreSkills(catalog, signals("a failing test"), DEFAULT_CONFIG);
    const b = scoreSkills(catalog, signals("a failing test"), DEFAULT_CONFIG);
    expect(a.map((m) => [m.skill.name, m.score])).toEqual(b.map((m) => [m.skill.name, m.score]));
  });

  it("returns an empty array for an empty catalogue", () => {
    expect(scoreSkills([], signals("anything at all"), DEFAULT_CONFIG)).toEqual([]);
  });
});
