import { scoreSkills } from "../src/scorer.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { CORPUS } from "./corpus.js";
import { CASES } from "./cases.js";

export interface BenchResult {
  precisionAt1: number;
  recallAt3: number;
  falsePositiveRate: number;
  cases: number;
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

  for (const testCase of CASES) {
    const matches = scoreSkills(CORPUS, { prompt: testCase.prompt, cwdExtensions: [] }, CONFIG);
    if (testCase.expected === null) {
      negatives += 1;
      if (matches.length > 0) falsePositives += 1;
      continue;
    }
    positives += 1;
    if (matches[0]?.skill.name === testCase.expected) top1 += 1;
    if (matches.slice(0, 3).some((m) => m.skill.name === testCase.expected)) inTop3 += 1;
  }

  return {
    precisionAt1: round(positives === 0 ? 0 : top1 / positives),
    recallAt3: round(positives === 0 ? 0 : inTop3 / positives),
    falsePositiveRate: round(negatives === 0 ? 0 : falsePositives / negatives),
    cases: CASES.length,
  };
}

const isMain = process.argv[1]?.endsWith("run.ts") ?? false;
if (isMain) {
  const result = evaluate();
  console.log(`cases:             ${result.cases}`);
  console.log(`precision@1:       ${result.precisionAt1}`);
  console.log(`recall@3:          ${result.recallAt3}`);
  console.log(`falsePositiveRate: ${result.falsePositiveRate}`);
}
