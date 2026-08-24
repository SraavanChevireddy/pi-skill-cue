import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

describe("package manifest", () => {
  it("declares itself a pi package with no runtime dependencies", () => {
    expect(pkg.name).toBe("pi-skill-cue");
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
  });

  it("ships only an allowlist, never tests or bench fixtures", () => {
    expect(pkg.files).toEqual(["extensions/", "src/", "README.md", "LICENSE"]);
    expect(pkg.files.join(" ")).not.toContain("tests");
    expect(pkg.files.join(" ")).not.toContain("bench");
  });

  it("declares the pi extension entry point", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions"]);
  });
});
