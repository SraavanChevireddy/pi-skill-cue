import { extractTriggerPhrases, tokenize } from "../src/text.js";
import type { SkillRecord } from "../src/types.js";

interface Seed {
  name: string;
  description: string;
}

/**
 * Invented skills, authored for this benchmark only. Deliberately includes near-neighbour pairs
 * (invoice-line-extraction vs invoice-reconciliation) so the scorer is measured on hard cases,
 * and several skills below are written imperatively with no "use when" clause at all, because
 * many real skills are authored that way and must be routed on term overlap alone.
 */
const SEEDS: Seed[] = [
  { name: "failing-test-triage", description: "Use when a test is failing, a suite is red, or behaviour does not match expectations, before changing implementation code" },
  { name: "invoice-line-extraction", description: "Extracts structured fields from invoices and receipts, including totals, dates, and line items." },
  { name: "invoice-reconciliation", description: "Use when matching invoice totals against ledger entries, or chasing a payment discrepancy" },
  { name: "widget-sensor-calibration", description: "Calibrates widget sensor tolerances and resets device baselines before a shipment." },
  { name: "banner-artwork", description: "Use when designing a banner, a social image, or promotional artwork for a campaign" },
  { name: "release-checklist", description: "Use when cutting a release, tagging a version, or preparing release notes for shipping" },
  { name: "schema-migration", description: "Writes and applies database migration scripts, adding or altering table columns." },
  { name: "flaky-test-quarantine", description: "Use when a test passes locally but fails intermittently in continuous integration" },
  { name: "ticket-intake", description: "Use when the user references a tracked work item by key such as ABC-123, or asks to triage a reported issue" },
  { name: "api-contract-review", description: "Use when changing a public endpoint, altering a response payload, or versioning an interface" },
  { name: "log-forensics", description: "Searches production logs to find the root cause of outages, error spikes, and request timeouts." },
  { name: "onboarding-walkthrough", description: "Use when a new contributor needs the local setup path, or asks how to run the project for the first time" },
  { name: "dependency-audit", description: "Use when adding a third party library, bumping a version, or reviewing a vulnerability advisory" },
  { name: "copy-editing", description: "Tightens written prose, adjusts tone, and rewrites documentation for clarity." },
];

export const CORPUS: SkillRecord[] = SEEDS.map((seed, index) => ({
  name: seed.name,
  path: `/fixtures/${seed.name}/SKILL.md`,
  description: seed.description,
  triggerPhrases: extractTriggerPhrases(seed.description),
  terms: [...new Set(tokenize(`${seed.name} ${seed.description}`))],
  mtimeMs: index + 1,
}));
