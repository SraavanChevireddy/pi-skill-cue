import { describe, expect, it } from "vitest";
import { CORPUS } from "../bench/corpus.js";
import { CASES } from "../bench/cases.js";
import { evaluate } from "../bench/run.js";
import baseline from "../bench/baseline.json" with { type: "json" };

describe("benchmark", () => {
  it("has a corpus and labelled cases", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(12);
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it("labels every case against a skill that exists in the corpus", () => {
    const names = new Set(CORPUS.map((s) => s.name));
    for (const testCase of CASES) {
      if (testCase.expected === null) continue;
      expect(names.has(testCase.expected)).toBe(true);
    }
  });

  it("includes negative cases that must match nothing", () => {
    expect(CASES.some((c) => c.expected === null)).toBe(true);
  });

  it("includes paraphrase cases that do not repeat description wording", () => {
    expect(CASES.some((c) => c.paraphrase === true)).toBe(true);
  });

  it("meets the committed baseline", () => {
    const result = evaluate();
    expect(result.precisionAt1).toBeGreaterThanOrEqual(baseline.precisionAt1);
    expect(result.recallAt3).toBeGreaterThanOrEqual(baseline.recallAt3);
    expect(result.falsePositiveRate).toBeLessThanOrEqual(baseline.falsePositiveRate);
  });

  it("matches the committed baseline on the hard subset exactly", () => {
    // Asserted exactly, not as a floor. The committed value is currently 0, and
    // `>= 0` cannot fail, so a floor here would silently permit any change. Pinning it means an
    // improvement is noticed and has to be recorded deliberately, and a regression cannot hide.
    const result = evaluate();
    expect(result.hardPrecisionAt1).toBe(baseline.hardPrecisionAt1);
  });

  it("has enough hard cases for that number to mean something", () => {
    const result = evaluate();
    expect(result.hardCases).toBeGreaterThanOrEqual(6);
  });
});
