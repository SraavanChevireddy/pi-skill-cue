import { describe, expect, it } from "vitest";
import { lintCatalog } from "../src/doctor.js";
import type { SkillRecord, SkillStats } from "../src/types.js";

function rec(name: string, description: string): SkillRecord {
  return {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description,
    triggerPhrases: description.toLowerCase().includes("use when") ? ["something specific here"] : [],
    terms: [...new Set(`${name} ${description}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))],
    mtimeMs: 1,
  };
}

const noStats = new Map<string, SkillStats>();

describe("lintCatalog", () => {
  it("flags a description that is too short to route on", () => {
    const findings = lintCatalog([rec("alpha", "Does stuff.")], noStats);
    expect(findings[0]?.codes).toContain("description-too-short");
  });

  it("flags a missing trigger clause", () => {
    const findings = lintCatalog([rec("beta", "A long and detailed explanation of what this skill contains for readers.")], noStats);
    expect(findings[0]?.codes).toContain("no-trigger-clause");
  });

  it("flags two skills whose descriptions are near-identical", () => {
    const findings = lintCatalog(
      [
        rec("gamma", "Use when reviewing pull requests and leaving review comments on them"),
        rec("delta", "Use when reviewing pull requests and leaving review comments on them"),
      ],
      noStats,
    );
    expect(findings.some((f) => f.codes.includes("overlapping-description"))).toBe(true);
  });

  it("flags a skill injected repeatedly but never read", () => {
    const stats = new Map<string, SkillStats>([["epsilon", { injections: 6, reads: 0, blocks: 0 }]]);
    const findings = lintCatalog([rec("epsilon", "Use when handling a specific documented situation arises")], stats);
    expect(findings[0]?.codes).toContain("never-read");
  });

  it("flags a skill whose name shares no terms with its description", () => {
    const findings = lintCatalog([rec("zebra", "Use when performing quarterly ledger reconciliation duties")], noStats);
    expect(findings[0]?.codes).toContain("name-description-disjoint");
  });

  it("returns no findings for a well-formed, exercised skill", () => {
    const stats = new Map<string, SkillStats>([["debugging-helper", { injections: 4, reads: 3, blocks: 0 }]]);
    const findings = lintCatalog(
      [rec("debugging-helper", "Use when debugging a failing test, an exception, or unexpected helper output")],
      stats,
    );
    expect(findings).toEqual([]);
  });
});
