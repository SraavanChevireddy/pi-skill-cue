import type { LintFinding } from "./doctor.js";
import type { SkillRecord, SkillStats } from "./types.js";

const EMPTY: SkillStats = { injections: 0, reads: 0, blocks: 0 };

const COLUMNS = { skill: "skill", injected: "injected", read: "read", blocked: "blocked" } as const;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/** Per-skill activity table plus a dead-weight summary. */
export function renderReport(records: SkillRecord[], stats: Map<string, SkillStats>): string {
  if (records.length === 0) return "No skills loaded, so there is nothing to report.";

  const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name));
  const rows = sorted.map((record) => {
    const stat = stats.get(record.name) ?? EMPTY;
    return {
      name: record.name,
      injections: String(stat.injections),
      reads: String(stat.reads),
      blocks: String(stat.blocks),
      neverFired: stat.injections === 0 && stat.reads === 0,
    };
  });

  // Widths come from the header label and the widest value, so a large count widens its column
  // instead of breaking the alignment.
  const widthOf = (label: string, values: string[]): number =>
    Math.max(label.length, ...values.map((value) => value.length));
  const nameWidth = widthOf(COLUMNS.skill, rows.map((row) => row.name));
  const injectedWidth = widthOf(COLUMNS.injected, rows.map((row) => row.injections));
  const readWidth = widthOf(COLUMNS.read, rows.map((row) => row.reads));

  const lines = [
    `${pad(COLUMNS.skill, nameWidth)} | ${pad(COLUMNS.injected, injectedWidth)} | ${pad(COLUMNS.read, readWidth)} | ${COLUMNS.blocked}`,
    `${"-".repeat(nameWidth)}-+-${"-".repeat(injectedWidth)}-+-${"-".repeat(readWidth)}-+-${"-".repeat(COLUMNS.blocked.length)}`,
  ];

  for (const row of rows) {
    lines.push(
      `${pad(row.name, nameWidth)} | ${pad(row.injections, injectedWidth)} | ${pad(row.reads, readWidth)} | ${row.blocks}`,
    );
  }

  const neverFired = rows.filter((row) => row.neverFired).length;
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
