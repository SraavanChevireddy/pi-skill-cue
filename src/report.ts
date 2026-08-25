import type { LintFinding } from "./doctor.js";
import type { SkillRecord, SkillStats } from "./types.js";

const EMPTY: SkillStats = { injections: 0, reads: 0, blocks: 0 };

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/** Per-skill activity table plus a dead-weight summary. */
export function renderReport(records: SkillRecord[], stats: Map<string, SkillStats>): string {
  if (records.length === 0) return "No skills loaded, so there is nothing to report.";

  const nameWidth = Math.max(6, ...records.map((r) => r.name.length));
  const lines = [
    `${pad("skill", nameWidth)} | injected | read | blocked`,
    `${"-".repeat(nameWidth)}-+----------+------+--------`,
  ];

  let neverFired = 0;
  for (const record of [...records].sort((a, b) => a.name.localeCompare(b.name))) {
    const stat = stats.get(record.name) ?? EMPTY;
    if (stat.injections === 0 && stat.reads === 0) neverFired += 1;
    lines.push(
      `${pad(record.name, nameWidth)} | ${pad(String(stat.injections), 8)} | ${pad(String(stat.reads), 4)} | ${stat.blocks}`,
    );
  }

  lines.push("", `${neverFired} of ${records.length} skills have never fired.`);
  return lines.join("\n");
}

export function renderDoctor(findings: LintFinding[]): string {
  if (findings.length === 0) return "No routability problems found.";

  const lines = [`${findings.length} skill(s) need attention:`, ""];
  for (const finding of findings) {
    lines.push(`${finding.skill} — ${finding.codes.join(", ")}`);
    lines.push(`  ${finding.path}`);
    lines.push(`  ${finding.suggestion}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
