// tests/text.test.ts
import { describe, expect, it } from "vitest";
import { extractTriggerPhrases, tokenize } from "../src/text.js";

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, and drops short tokens", () => {
    expect(tokenize("Fix the Login-Bug in api_v2")).toEqual(["fix", "login", "bug", "api"]);
  });

  it("drops filler but keeps domain words", () => {
    expect(tokenize("please help me refactor the authentication module")).toEqual([
      "refactor",
      "authentication",
      "module",
    ]);
  });

  it("folds diacritics instead of shredding accented words into fragments", () => {
    expect(tokenize("naïve café résumé")).toEqual(["naive", "cafe", "resume"]);
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("extractTriggerPhrases", () => {
  it("pulls the clause after 'use when'", () => {
    const phrases = extractTriggerPhrases(
      "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes",
    );
    expect(phrases).toContain("encountering any bug");
    expect(phrases).toContain("test failure");
    expect(phrases).toContain("unexpected behavior");
  });

  it("handles 'Use this when' and 'when the user' phrasings", () => {
    expect(extractTriggerPhrases("Use this when creating a new theme")).toContain("creating a new theme");
    expect(extractTriggerPhrases("Activate when the user asks about billing")).toContain("the user asks about billing");
  });

  it("returns nothing when the description has no trigger clause", () => {
    expect(extractTriggerPhrases("A helpful collection of utilities.")).toEqual([]);
  });

  it("ignores clause fragments that are too short to be meaningful", () => {
    expect(extractTriggerPhrases("Use when x, or y")).toEqual([]);
  });

  it("requires a word boundary, so 'misuse when' is not a lead", () => {
    expect(extractTriggerPhrases("Misuse when handling authentication flows")).toEqual([]);
  });

  it("truncates a clause at the end of its sentence", () => {
    expect(extractTriggerPhrases("Use when debugging failures. Do not use otherwise.")).toEqual([
      "debugging failures",
    ]);
  });

  it("keeps clauses from separate leads from bleeding into each other", () => {
    expect(extractTriggerPhrases("Use when refactoring modules, use when renaming symbols")).toEqual([
      "refactoring modules",
      "renaming symbols",
    ]);
  });

  it("deduplicates a clause repeated across sentences", () => {
    expect(extractTriggerPhrases("Use when creating a theme. Use when creating a theme.")).toEqual([
      "creating a theme",
    ]);
  });
});
