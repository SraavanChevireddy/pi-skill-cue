import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("DEFAULT_CONFIG", () => {
  it("is advisory-only out of the box", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONFIG.gates).toEqual({});
    expect(DEFAULT_CONFIG.escalate.enabled).toBe(false);
  });

  it("caps injection volume", () => {
    expect(DEFAULT_CONFIG.maxSkills).toBe(3);
    expect(DEFAULT_CONFIG.threshold).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.threshold).toBeLessThan(1);
  });
});
