import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

describe("package manifest", () => {
  it("declares itself a pi package with no runtime dependencies", () => {
    expect(pkg.name).toBe("pi-skill-cue");
    expect(pkg.keywords).toContain("pi-package");
    const manifest = pkg as typeof pkg & { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
  });

  it(
    "ships only an allowlist, never tests or bench fixtures",
    async () => {
      expect(pkg.files).toEqual(["extensions/", "src/", "README.md", "LICENSE"]);

      const packed = JSON.parse(
        execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
      );
      const paths = packed[0].files.map((f: { path: string }) => f.path);
      expect(paths.some((p: string) => p.startsWith("tests/") || p.startsWith("bench/"))).toBe(
        false,
      );
    },
    30000,
  );

  it("declares the pi extension entry point", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions"]);
  });
});
