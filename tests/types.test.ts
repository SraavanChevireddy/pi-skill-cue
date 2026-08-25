import { describe, expect, it } from "vitest";
import { createDefaultConfig, DEFAULT_CONFIG } from "../src/types.js";

describe("DEFAULT_CONFIG", () => {
  it("is advisory-only out of the box", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONFIG.gates).toEqual({});
    expect(DEFAULT_CONFIG.escalate.enabled).toBe(false);
    expect(DEFAULT_CONFIG.mute).toEqual([]);
    expect(DEFAULT_CONFIG.triggers).toEqual({});
  });

  it("threshold is a normalised fraction so it stays comparable across catalogue sizes", () => {
    expect(DEFAULT_CONFIG.maxSkills).toBe(3);
    expect(DEFAULT_CONFIG.threshold).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.threshold).toBeLessThan(1);
  });

  it("hands out an independent config each call", () => {
    const first = createDefaultConfig();
    first.mute.push("x");
    first.gates.alpha = { tools: ["write"] };
    const second = createDefaultConfig();
    expect(second.mute).toEqual([]);
    expect(second.gates).toEqual({});
  });
});
