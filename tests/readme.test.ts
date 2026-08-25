import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate } from "../bench/run.js";

const readme = readFileSync("README.md", "utf8");

describe("README", () => {
  it("leads with install and the problem statement", () => {
    expect(readme).toContain("pi install npm:pi-skill-cue");
    expect(readme.toLowerCase()).toContain("models don't always do this");
  });

  it("publishes the current benchmark numbers", () => {
    const result = evaluate();
    expect(readme).toMatch(new RegExp(`Precision@1[^\\n|]*\\|[^\\n|]*${result.precisionAt1}`, "i"));
    expect(readme).toMatch(new RegExp(`Recall@3[^\\n|]*\\|[^\\n|]*${result.recallAt3}`, "i"));
  });

  it("states the privacy position", () => {
    expect(readme.toLowerCase()).toContain("never leaves your machine");
    expect(readme).toContain("/cue-report --purge");
  });

  it("documents every command", () => {
    for (const cmd of ["/cue", "/cue off", "/cue-report", "/skill-doctor"]) {
      expect(readme).toContain(cmd);
    }
  });

  it("contains no absolute home paths", () => {
    expect(readme).not.toMatch(/\/(?:Users|home)\/[A-Za-z0-9._-]+\//);
  });
});
