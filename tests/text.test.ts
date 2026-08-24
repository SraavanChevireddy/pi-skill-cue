import { describe, expect, it } from "vitest";
import { extractTriggerPhrases, tokenize } from "../src/text.js";

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, and drops short tokens", () => {
    expect(tokenize("Fix the Login-Bug in api_v2")).toEqual(["fix", "login", "bug", "api"]);
  });

  it("drops stopwords that carry no routing signal", () => {
    expect(tokenize("use this when you are the one that has code")).toEqual([]);
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
});
