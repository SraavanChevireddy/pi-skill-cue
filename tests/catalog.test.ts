import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildCatalog, parseSkillFile } from "../src/catalog.js";

function skillDir(name: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), "cue-skill-"));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, body);
  return path;
}

describe("parseSkillFile", () => {
  it("reads name and description from frontmatter", () => {
    const path = skillDir("alpha", `---\nname: alpha\ndescription: Use when reviewing pull requests\n---\n\n# Alpha\n`);
    const parsed = parseSkillFile(path);
    expect(parsed?.name).toBe("alpha");
    expect(parsed?.description).toBe("Use when reviewing pull requests");
  });

  it("supports a quoted multi-word description", () => {
    const path = skillDir("beta", `---\nname: beta\ndescription: "Use when writing docs, or editing README files"\n---\n`);
    expect(parseSkillFile(path)?.description).toBe("Use when writing docs, or editing README files");
  });

  it("returns undefined for a file with no frontmatter", () => {
    const path = skillDir("gamma", `# Gamma\n\nNo frontmatter here.\n`);
    expect(parseSkillFile(path)).toBeUndefined();
  });

  it("returns undefined for an absent file rather than throwing", () => {
    expect(parseSkillFile("/nonexistent/SKILL.md")).toBeUndefined();
  });
});

describe("buildCatalog", () => {
  it("produces records with extracted triggers and terms", () => {
    const path = skillDir("debugger", `---\nname: systematic-debugging\ndescription: Use when encountering a failing test or unexpected behaviour\n---\n`);
    const [record] = buildCatalog([{ name: "systematic-debugging", path }]);
    expect(record?.name).toBe("systematic-debugging");
    expect(record?.triggerPhrases).toContain("encountering a failing test");
    expect(record?.terms).toContain("debugging");
    expect(record?.mtimeMs).toBeGreaterThan(0);
  });

  it("skips a skill whose file cannot be parsed instead of failing the catalogue", () => {
    const good = skillDir("good", `---\nname: good\ndescription: Use when doing good things here\n---\n`);
    const records = buildCatalog([
      { name: "broken", path: "/nonexistent/SKILL.md" },
      { name: "good", path: good },
    ]);
    expect(records.map((r) => r.name)).toEqual(["good"]);
  });

  it("prefers a description supplied by pi over re-reading the file", () => {
    const path = skillDir("delta", `---\nname: delta\ndescription: stale on-disk text\n---\n`);
    const [record] = buildCatalog([{ name: "delta", path, description: "Use when handling fresh input data" }]);
    expect(record?.description).toBe("Use when handling fresh input data");
  });

  it("reuses cached records until mtime changes", () => {
    const path = skillDir("epsilon", `---\nname: epsilon\ndescription: Use when caching results for later\n---\n`);
    const input = [{ name: "epsilon", path }];
    const first = buildCatalog(input);
    const second = buildCatalog(input);
    expect(second[0]).toBe(first[0]);

    const future = new Date(Date.now() + 5_000);
    utimesSync(path, future, future);
    const third = buildCatalog(input);
    expect(third[0]).not.toBe(first[0]);
  });
});
