import type { SkillRecord, SkillStats } from "./types.js";

export type LintCode =
  | "description-too-short"
  | "no-trigger-clause"
  | "overlapping-description"
  | "never-read"
  | "name-description-disjoint";

export interface LintFinding {
  skill: string;
  path: string;
  codes: LintCode[];
  suggestion: string;
}

const MIN_DESCRIPTION_LENGTH = 40;
const NEVER_READ_INJECTIONS = 5;
const OVERLAP_THRESHOLD = 0.85;

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const term of setA) if (setB.has(term)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

function descriptionTerms(description: string): string[] {
  return description.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

function suggestionFor(record: SkillRecord, codes: LintCode[]): string {
  if (codes.includes("description-too-short") || codes.includes("no-trigger-clause")) {
    return `Rewrite as: "Use when <situation>, <situation>, or <situation>." naming the words a user would actually type when they need ${record.name}.`;
  }
  if (codes.includes("overlapping-description")) {
    return "Differentiate the trigger clauses so the two skills cannot both match the same request.";
  }
  if (codes.includes("never-read")) {
    return "The router surfaces this skill but the model declines to read it. Sharpen the trigger clause, or add a gate if it is mandatory.";
  }
  return `Include the words from the skill name in the description so both match paths agree.`;
}

/** Lint a catalogue for routability problems. Pure given stats. */
export function lintCatalog(
  records: SkillRecord[],
  stats: Map<string, SkillStats>,
): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const record of records) {
    const codes: LintCode[] = [];

    if (record.description.trim().length < MIN_DESCRIPTION_LENGTH) codes.push("description-too-short");
    if (record.triggerPhrases.length === 0) codes.push("no-trigger-clause");

    for (const other of records) {
      if (other.name === record.name) continue;
      if (jaccard(descriptionTerms(record.description), descriptionTerms(other.description)) >= OVERLAP_THRESHOLD) {
        codes.push("overlapping-description");
        break;
      }
    }

    const stat = stats.get(record.name);
    if (stat && stat.injections >= NEVER_READ_INJECTIONS && stat.reads === 0) codes.push("never-read");

    const nameTerms = descriptionTerms(record.name);
    const descTerms = descriptionTerms(record.description);
    if (nameTerms.length > 0 && !nameTerms.some((t) => descTerms.includes(t))) {
      codes.push("name-description-disjoint");
    }

    if (codes.length > 0) {
      findings.push({
        skill: record.name,
        path: record.path,
        codes: [...new Set(codes)],
        suggestion: suggestionFor(record, codes),
      });
    }
  }

  return findings;
}
