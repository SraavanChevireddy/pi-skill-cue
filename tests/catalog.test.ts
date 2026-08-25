import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCatalog, clearCatalogCache, parseSkillFile } from "../src/catalog.js";

/** Beat coarse filesystem mtime granularity when forcing a cache miss. */
const MTIME_SKEW_MS = 5_000;

function skillDir(name: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), "cue-skill-"));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, body);
  return path;
}

beforeEach(() => {
  clearCatalogCache();
});

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

  it("reads a folded block scalar description as one line", () => {
    const path = skillDir(
      "folded",
      `---\nname: folded\ndescription: >\n  Use when handling a long description\n  that wraps onto two lines\n---\n`,
    );
    expect(parseSkillFile(path)?.description).toBe(
      "Use when handling a long description that wraps onto two lines",
    );
  });

  it("tolerates a byte-order mark before the frontmatter", () => {
    const path = skillDir("bom", `\uFEFF---\nname: bom\ndescription: Use when handling encoded files\n---\n`);
    expect(parseSkillFile(path)?.name).toBe("bom");
  });
});

describe("buildCatalog", () => {
  it("produces records with extracted triggers and terms", () => {
    const path = skillDir("debugger", `---\nname: systematic-debugging\ndescription: Use when encountering a failing test or unexpected behaviour\n---\n`);
    const [record] = buildCatalog([{ name: "systematic-debugging", path }]);
    expect(record?.name).toBe("systematic-debugging");
    expect(record?.triggerPhrases).toContain("encountering a failing test");
    expect(record?.terms).toContain("debugging");
    expect(record?.mtimeMs).toBe(statSync(path).mtimeMs);
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

    const future = new Date(Date.now() + MTIME_SKEW_MS);
    utimesSync(path, future, future);
    const third = buildCatalog(input);
    expect(third[0]).not.toBe(first[0]);
  });

  it("extracts trigger phrases from a folded description", () => {
    const path = skillDir(
      "wrapped",
      `---\nname: wrapped\ndescription: >\n  Use when reviewing a pull request,\n  or leaving review comments\n---\n`,
    );
    const [record] = buildCatalog([{ name: "wrapped", path }]);
    expect(record?.triggerPhrases).toContain("reviewing a pull request");
  });

  it("drops a skill whose file exists but has no frontmatter and no supplied description", () => {
    const path = skillDir("bare", `# Bare\n\nNothing to parse.\n`);
    expect(buildCatalog([{ name: "bare", path }])).toEqual([]);
  });

  it("freezes records so a consumer cannot corrupt the cache", () => {
    const path = skillDir("frozen", `---\nname: frozen\ndescription: Use when freezing records solid\n---\n`);
    const [record] = buildCatalog([{ name: "frozen", path }]);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record?.terms)).toBe(true);
  });

  it("evicts cache entries for skills that are no longer present", () => {
    const path = skillDir("transient", `---\nname: transient\ndescription: Use when a skill disappears midway\n---\n`);
    const first = buildCatalog([{ name: "transient", path }]);
    expect(first).toHaveLength(1);
    buildCatalog([]);
    const third = buildCatalog([{ name: "transient", path }]);
    expect(third[0]).not.toBe(first[0]);
  });

  it("treats a changed description from pi as a cache miss", () => {
    const path = skillDir("changing", `---\nname: changing\ndescription: Use when descriptions change underneath us\n---\n`);
    const first = buildCatalog([{ name: "changing", path, description: "Use when the first description applies" }]);
    const second = buildCatalog([{ name: "changing", path, description: "Use when the second description applies" }]);
    expect(second[0]?.description).toBe("Use when the second description applies");
    expect(second[0]).not.toBe(first[0]);
  });
});
