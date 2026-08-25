import { describe, expect, it } from "vitest";
import { deriveRoutingFields } from "../src/catalog.js";
import { lintCatalog } from "../src/doctor.js";
import type { SkillRecord, SkillStats } from "../src/types.js";

function rec(name: string, description: string): SkillRecord {
  return {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description,
    mtimeMs: 1,
    ...deriveRoutingFields(name, description),
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

  it("does not call two skills overlapping merely because both say 'use when'", () => {
    const findings = lintCatalog(
      [
        rec("invoice-parsing", "Use when extracting fields from an invoice document or receipt"),
        rec("release-checklist", "Use when cutting a release, tagging a version, or writing notes"),
      ],
      noStats,
    );
    expect(findings.some((f) => f.codes.includes("overlapping-description"))).toBe(false);
  });

  it("reports a finding for each skill in an overlapping pair", () => {
    const findings = lintCatalog(
      [
        rec("alpha-review", "Use when reviewing a pull request and leaving comments on the diff"),
        rec("beta-review", "Use when reviewing a pull request and leaving comments on the diff"),
      ],
      noStats,
    );
    expect(findings.map((f) => f.skill).sort()).toEqual(["alpha-review", "beta-review"]);
  });

  it("does not flag a skill that has been read at least once", () => {
    const stats = new Map<string, SkillStats>([["epsilon", { injections: 9, reads: 1, blocks: 0 }]]);
    const findings = lintCatalog([rec("epsilon", "Use when handling a documented epsilon situation")], stats);
    expect(findings.some((f) => f.codes.includes("never-read"))).toBe(false);
  });
});
