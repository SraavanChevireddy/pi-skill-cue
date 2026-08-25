import { describe, expect, it } from "vitest";
import { deriveRoutingFields } from "../src/catalog.js";
import { renderDoctor, renderReport } from "../src/report.js";
import type { SkillRecord, SkillStats } from "../src/types.js";

const records: SkillRecord[] = [
  { name: "alpha", path: "/fixtures/alpha/SKILL.md", description: "Use when doing alpha work here", mtimeMs: 1, ...deriveRoutingFields("alpha", "Use when doing alpha work here") },
  { name: "beta", path: "/fixtures/beta/SKILL.md", description: "Use when doing beta work here", mtimeMs: 1, ...deriveRoutingFields("beta", "Use when doing beta work here") },
];

describe("renderReport", () => {
  it("lists every installed skill with its counts", () => {
    const stats = new Map<string, SkillStats>([["alpha", { injections: 3, reads: 2, blocks: 1 }]]);
    const text = renderReport(records, stats);
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).toMatch(/alpha\s+\|\s+3\s+\|\s+2\s+\|\s+1/);
  });

  it("summarises how many skills have never fired", () => {
    const text = renderReport(records, new Map([["alpha", { injections: 1, reads: 1, blocks: 0 }]]));
    expect(text).toContain("1 of 2 skills have never fired");
  });

  it("handles an empty catalogue without throwing", () => {
    expect(renderReport([], new Map())).toContain("No skills loaded");
  });

  it("widens a column instead of breaking alignment on a large count", () => {
    const stats = new Map<string, SkillStats>([["alpha", { injections: 1234567, reads: 89, blocks: 0 }]]);
    const lines = renderReport(records, stats).split("\n");
    const header = lines[0] ?? "";
    const alphaRow = lines.find((line) => line.startsWith("alpha")) ?? "";
    expect(alphaRow).toContain("1234567");
    // Every row's column separators line up with the header's.
    const separatorPositions = (line: string) => [...line].flatMap((ch, i) => (ch === "|" ? [i] : []));
    expect(separatorPositions(alphaRow)).toEqual(separatorPositions(header));
  });
});

describe("renderDoctor", () => {
  it("reports a clean bill of health", () => {
    expect(renderDoctor([])).toContain("No routability problems found");
  });

  it("lists findings with codes and a suggestion", () => {
    const text = renderDoctor([
      { skill: "alpha", path: "/fixtures/alpha/SKILL.md", codes: ["no-trigger-clause"], suggestion: "Rewrite it." },
    ]);
    expect(text).toContain("alpha");
    expect(text).toContain("no-trigger-clause");
    expect(text).toContain("Rewrite it.");
  });
});
