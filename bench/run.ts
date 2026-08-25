import { scoreSkills } from "../src/scorer.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { CORPUS } from "./corpus.js";
import { CASES } from "./cases.js";
import baseline from "./baseline.json" with { type: "json" };

export interface BenchResult {
  precisionAt1: number;
  recallAt3: number;
  falsePositiveRate: number;
  cases: number;
  /** precision@1 over the cases flagged hard: low vocabulary overlap with the description. */
  hardPrecisionAt1: number;
  hardCases: number;
}

const CONFIG = { ...DEFAULT_CONFIG, triggers: { "ticket-intake": ["\\b[A-Z]{2,}-\\d{3,}\\b"] } };

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function evaluate(): BenchResult {
  let positives = 0;
  let top1 = 0;
  let inTop3 = 0;
  let negatives = 0;
  let falsePositives = 0;
  let hardPositives = 0;
  let hardTop1 = 0;

  for (const testCase of CASES) {
    const matches = scoreSkills(CORPUS, { prompt: testCase.prompt, cwdExtensions: [] }, CONFIG);
    if (testCase.expected === null) {
      negatives += 1;
      if (matches.length > 0) falsePositives += 1;
      continue;
    }
    positives += 1;
    const top1Match = matches[0]?.skill.name === testCase.expected;
    if (top1Match) top1 += 1;
    if (matches.slice(0, 3).some((m) => m.skill.name === testCase.expected)) inTop3 += 1;

    if (testCase.hard === true) {
      hardPositives += 1;
      if (top1Match) hardTop1 += 1;
    }
  }

  return {
    precisionAt1: round(positives === 0 ? 0 : top1 / positives),
    recallAt3: round(positives === 0 ? 0 : inTop3 / positives),
    falsePositiveRate: round(negatives === 0 ? 0 : falsePositives / negatives),
    cases: CASES.length,
    hardPrecisionAt1: round(hardPositives === 0 ? 0 : hardTop1 / hardPositives),
    hardCases: hardPositives,
  };
}

const isMain = process.argv[1]?.endsWith("run.ts") ?? false;
if (isMain) {
  const result = evaluate();
  console.log(`cases:             ${result.cases}`);
  console.log(`precision@1:       ${result.precisionAt1}`);
  console.log(`recall@3:          ${result.recallAt3}`);
  console.log(`falsePositiveRate: ${result.falsePositiveRate}`);
  console.log(`hard precision@1:  ${result.hardPrecisionAt1} (${result.hardCases} cases)`);

  // Enforce here as well as in tests/bench.test.ts, so the gate survives a change to the suite.
  const regressions = [
    result.precisionAt1 < baseline.precisionAt1 ? `precision@1 ${result.precisionAt1} < ${baseline.precisionAt1}` : "",
    result.recallAt3 < baseline.recallAt3 ? `recall@3 ${result.recallAt3} < ${baseline.recallAt3}` : "",
    result.falsePositiveRate > baseline.falsePositiveRate
      ? `falsePositiveRate ${result.falsePositiveRate} > ${baseline.falsePositiveRate}`
      : "",
    result.hardPrecisionAt1 < baseline.hardPrecisionAt1
      ? `hard precision@1 ${result.hardPrecisionAt1} < ${baseline.hardPrecisionAt1}`
      : "",
  ].filter(Boolean);

  if (regressions.length > 0) {
    console.error(`\nbench: regression against bench/baseline.json`);
    for (const regression of regressions) console.error(`  ${regression}`);
    process.exit(1);
  }
  console.log("\nbench: at or above baseline");
}
