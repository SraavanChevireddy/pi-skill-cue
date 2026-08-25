import { describe, expect, it } from "vitest";
import { deriveRoutingFields } from "../src/catalog.js";
import { scoreSkills } from "../src/scorer.js";
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

/** Mirrors what buildCatalog derives, via the same function it uses. */
function withDerived(r: SkillRecord): SkillRecord {
  return { ...r, ...deriveRoutingFields(r.name, r.description) };
}

const catalog: SkillRecord[] = [
  record("systematic-debugging", "Use when encountering a failing test or unexpected behaviour, before proposing fixes"),
  record("banner-design", "Use when designing banners for social media, ads, or website heroes"),
  record("ticket-workflow", "Use when the user references a tracked work item by key"),
  record("config-audit", "Use when reviewing json configuration files"),
].map(withDerived);

const signals = (prompt: string) => ({ prompt, cwdExtensions: [] as string[] });

describe("scoreSkills", () => {
  it("ranks a trigger-phrase match above unrelated skills", () => {
    const matches = scoreSkills(catalog, signals("I have a failing test and no idea why"), DEFAULT_CONFIG);
    expect(matches[0]?.skill.name).toBe("systematic-debugging");
    expect(matches[0]?.reasons.some((r) => r.kind === "trigger")).toBe(true);
  });

  it("normalises every score into 0..1", () => {
    const matches = scoreSkills(catalog, signals("designing banners for ads"), DEFAULT_CONFIG);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
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
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const prompt = signals("failing test while designing banners");
    expect(scoreSkills(catalog, prompt, permissive).length).toBeGreaterThan(1);
    expect(scoreSkills(catalog, prompt, { ...permissive, maxSkills: 1 })).toHaveLength(1);
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

  it("breaks a score tie alphabetically regardless of input order", () => {
    const pair = [
      record("zeta-skill", "Use when handling identical twin descriptions"),
      record("alpha-skill", "Use when handling identical twin descriptions"),
    ].map(withDerived);
    const matches = scoreSkills(pair, signals("handling identical twin descriptions"), {
      ...DEFAULT_CONFIG,
      threshold: 0.01,
    });
    expect(matches.map((m) => m.skill.name)).toEqual(["alpha-skill", "zeta-skill"]);
  });

  it("returns an empty array for an empty catalogue", () => {
    expect(scoreSkills([], signals("anything at all"), DEFAULT_CONFIG)).toEqual([]);
  });

  it("adds a context reason when a working-directory extension matches a skill term", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const withContext = scoreSkills(catalog, { prompt: "check the configuration", cwdExtensions: ["json"] }, permissive);
    const withoutContext = scoreSkills(catalog, { prompt: "check the configuration", cwdExtensions: [] }, permissive);
    const hit = withContext.find((m) => m.skill.name === "config-audit");
    const base = withoutContext.find((m) => m.skill.name === "config-audit");
    expect(hit?.reasons.some((r) => r.kind === "context")).toBe(true);
    expect(hit?.score ?? 0).toBeGreaterThan(base?.score ?? 0);
  });

  it("does not treat a short extension as a substring of a skill's words", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const matches = scoreSkills(catalog, { prompt: "make me a banner", cwdExtensions: ["rs"] }, permissive);
    const banner = matches.find((m) => m.skill.name === "banner-design");
    expect(banner?.reasons.some((r) => r.kind === "context") ?? false).toBe(false);
  });

  it("clamps a score that would otherwise exceed one", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const matches = scoreSkills(
      catalog,
      { prompt: "reviewing json configuration files", cwdExtensions: ["json"] },
      permissive,
    );
    expect(matches.find((m) => m.skill.name === "config-audit")?.score).toBe(1);
  });

  it("does not let a partial phrase match fire on a word that merely contains a trigger word", () => {
    const only = [record("failing-test-triage", "Use when a test is failing")].map(withDerived);
    const matches = scoreSkills(only, signals("the latest contest results"), { ...DEFAULT_CONFIG, threshold: 0.01 });
    expect(matches.some((m) => m.reasons.some((r) => r.kind === "trigger"))).toBe(false);
  });

  it("ignores an unparseable configured regex instead of throwing", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, triggers: { "ticket-workflow": ["([unclosed"] } };
    expect(() => scoreSkills(catalog, signals("take a look at ABC-1234"), config)).not.toThrow();
    const names = scoreSkills(catalog, signals("unrelated chatter entirely"), config).map((m) => m.skill.name);
    expect(names).not.toContain("ticket-workflow");
  });

  it("muting a skill does not change the scores of the skills that remain", () => {
    const prompt = signals("I have a failing test");
    const before = scoreSkills(catalog, prompt, { ...DEFAULT_CONFIG, threshold: 0.01 });
    const after = scoreSkills(catalog, prompt, { ...DEFAULT_CONFIG, threshold: 0.01, mute: ["banner-design"] });
    const scoreOf = (list: typeof before, name: string) => list.find((m) => m.skill.name === name)?.score;
    expect(scoreOf(after, "systematic-debugging")).toBe(scoreOf(before, "systematic-debugging"));
  });
});
