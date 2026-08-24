import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig, mergeConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/types.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cue-config-"));
}

describe("mergeConfig", () => {
  it("returns defaults when both layers are absent", () => {
    expect(mergeConfig(undefined, undefined)).toEqual(DEFAULT_CONFIG);
  });

  it("replaces a top-level key outright rather than deep-merging", () => {
    const merged = mergeConfig(
      { gates: { alpha: { tools: ["write"] } } },
      { gates: { beta: { tools: ["edit"] } } },
    );
    expect(merged.gates).toEqual({ beta: { tools: ["edit"] } });
  });

  it("falls back to the default for an out-of-range threshold", () => {
    expect(mergeConfig({ threshold: 5 }, undefined).threshold).toBe(DEFAULT_CONFIG.threshold);
    expect(mergeConfig({ threshold: -1 }, undefined).threshold).toBe(DEFAULT_CONFIG.threshold);
  });

  it("ignores unknown keys", () => {
    const merged = mergeConfig({ nonsense: true } as never, undefined);
    expect(merged).toEqual(DEFAULT_CONFIG);
    expect("nonsense" in merged).toBe(false);
  });

  it("drops a gate whose tools list is not an array of strings", () => {
    const merged = mergeConfig({ gates: { alpha: { tools: "write" } } } as never, undefined);
    expect(merged.gates).toEqual({});
  });
});

describe("loadConfig", () => {
  it("reads global and project files, project winning", () => {
    const dir = tmp();
    writeFileSync(join(dir, "global.json"), JSON.stringify({ maxSkills: 9, verbose: true }));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ maxSkills: 1 }));
    const config = loadConfig(join(dir, "global.json"), join(dir, "project.json"));
    expect(config.maxSkills).toBe(1);
    expect(config.verbose).toBe(true);
  });

  it("returns defaults when a file is missing or malformed", () => {
    const dir = tmp();
    writeFileSync(join(dir, "broken.json"), "{ not json");
    expect(loadConfig(join(dir, "broken.json"), join(dir, "absent.json"))).toEqual(DEFAULT_CONFIG);
  });
});
