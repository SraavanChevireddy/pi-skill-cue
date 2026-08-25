import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts", "check-leaks.mjs");

function run(dir: string): { status: number; output: string } {
  try {
    const output = execFileSync("node", [script, "--dir", dir], { encoding: "utf8" });
    return { status: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cue-leak-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

describe("check-leaks", () => {
  it("passes on clean content", () => {
    expect(run(fixture({ "src/a.ts": "export const x = 1;\n" })).status).toBe(0);
  });

  it("fails on an absolute home path", () => {
    const result = run(fixture({ "src/a.ts": 'const p = "/Users/someone/projects/thing";\n' })); // leak-guard-allow
    expect(result.status).toBe(1);
    expect(result.output).toContain("absolute-home-path");
  });

  it("skips a line carrying the inline suppression marker", () => {
    const dir = fixture({ "src/a.ts": 'const p = "/Users/someone/x/"; // leak-guard-allow\n' });
    expect(run(dir).status).toBe(0);
  });

  it("still reports other lines in a file that contains a suppressed line", () => {
    const dir = fixture({
      "src/a.ts": 'const ok = "x"; // leak-guard-allow\nconst bad = "person@example.com";\n',
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("email-address");
  });

  it("fails on an email address", () => {
    const result = run(fixture({ "README.md": "contact person@example.com\n" }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("email-address");
  });

  it("fails on a token-shaped string", () => {
    const result = run(fixture({ "src/a.ts": 'const k = "sk-abcdefghijklmnopqrstuvwxyz012345";\n' }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("credential-shape");
  });

  it("fails on a committed dotenv file", () => {
    expect(run(fixture({ ".env": "SECRET=1\n" })).status).toBe(1);
  });

  it("applies extra patterns from a local pattern file", () => {
    const dir = fixture({ "README.md": "internalwidgetcorp is great\n" });
    writeFileSync(join(dir, ".leakpatterns.local"), "internalwidgetcorp\n# a comment\n\n");
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("local-pattern");
  });

  it("ignores its own pattern file as a finding source", () => {
    const dir = fixture({ "src/a.ts": "export const x = 1;\n" });
    writeFileSync(join(dir, ".leakpatterns.local"), "neverappearsanywhere\n");
    expect(run(dir).status).toBe(0);
  });

  it("fails in strict mode when no local pattern file is present", () => {
    const result = (() => {
      const dir = fixture({ "src/a.ts": "export const x = 1;\n" });
      try {
        execFileSync("node", [script, "--dir", dir, "--strict"], { encoding: "utf8" });
        return { status: 0, output: "" };
      } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    })();
    expect(result.status).toBe(1);
    expect(result.output).toContain("strict mode");
  });
});
