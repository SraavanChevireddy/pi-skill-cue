# pi-skill-cue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public pi package that matches each user prompt to the right installed skill, injects it where the model will act on it, optionally blocks work until a required skill is read, and reports which skills never fire.

**Architecture:** One pi extension entry point wiring six independent units — config, catalog, scorer, injector, gatekeeper, ledger — plus doctor/report renderers. The scorer is a pure function so match quality is a unit-tested number. Every hook is fail-open: any error returns `undefined` and the session behaves as vanilla pi.

**Tech Stack:** TypeScript (shipped as source; pi loads `.ts` extensions natively, no build step), vitest for tests, node:fs only. Zero runtime dependencies. `@earendil-works/pi-coding-agent` is a peer dependency.

**Spec:** `docs/superpowers/specs/2026-08-24-pi-skill-cue-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `extensions/skill-cue.ts` | Extension entry. Registers hooks and commands, wires units, wraps every handler in try/catch. No logic of its own. |
| `src/types.ts` | Shared types. No behaviour. |
| `src/text.ts` | Tokenising, stopwords, trigger-phrase extraction. Pure. |
| `src/config.ts` | Load, merge, and validate config from global + project files. |
| `src/catalog.ts` | Build `SkillRecord[]` from pi's loaded skills, parsing each `SKILL.md`. mtime-cached. |
| `src/scorer.ts` | Pure scoring. `(records, signals, config) → RankedMatch[]`. |
| `src/injector.ts` | Render ranked matches into a budget-capped directive string. Pure. |
| `src/gatekeeper.ts` | Per-session satisfaction state, block decisions, anti-deadlock counter. |
| `src/ledger.ts` | Append-only JSONL read/append/purge. Swallows its own failures. |
| `src/doctor.ts` | Lint rules over catalog + ledger stats. Pure given stats. |
| `src/report.ts` | Render report and doctor output as text tables. Pure. |
| `bench/corpus.ts` | Invented skill catalogue. Authored from scratch. |
| `bench/cases.ts` | Labelled prompt → expected skill cases. |
| `bench/run.ts` | Computes precision@1, recall@3, false-positive rate; compares to baseline. |
| `scripts/check-leaks.mjs` | Scans git index + `npm pack --dry-run` contents against generic and local patterns. |

**Boundary rules:** `src/scorer.ts`, `src/injector.ts`, `src/text.ts`, `src/report.ts`, and `src/doctor.ts` perform no I/O and import no pi types. Only `extensions/skill-cue.ts` imports from `@earendil-works/pi-coding-agent`. This keeps the whole matching engine testable without a running pi.

---

### Task 1: Repository scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `LICENSE`
- Test: `tests/package-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/package-manifest.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/package-manifest.test.ts`
Expected: FAIL — cannot resolve `../package.json` / vitest not installed.

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "name": "pi-skill-cue",
  "version": "0.1.0",
  "description": "Skill router for pi. Matches every prompt to the right skill, injects it where the model will actually see it, and optionally blocks work until it is read.",
  "license": "MIT",
  "type": "module",
  "keywords": ["pi-package", "pi", "skill", "router", "skills"],
  "files": ["extensions/", "src/", "README.md", "LICENSE"],
  "pi": {
    "extensions": ["./extensions"]
  },
  "private": true,
  "engines": { "node": ">=20.19.0" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "bench": "tsx bench/run.ts",
    "check:leaks": "node scripts/check-leaks.mjs",
    "prepublishOnly": "npm run typecheck && npm run test && npm run bench && npm run check:leaks -- --strict"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.11"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "extensions", "tests", "bench"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

Create `LICENSE` as the standard MIT text, copyright holder `pi-skill-cue contributors`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run tests/package-manifest.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts LICENSE tests/package-manifest.test.ts package-lock.json
git commit -m "chore: scaffold package with allowlist packaging and zero runtime deps"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/types.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL — cannot find module `../src/types.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/types.ts

/** A skill normalised for routing. */
export interface SkillRecord {
  /** Skill name as pi reports it. */
  name: string;
  /** Absolute path to the skill's SKILL.md. */
  path: string;
  description: string;
  /** Phrases extracted from "use when ..." clauses in the description. */
  triggerPhrases: string[];
  /** Normalised tokens from name + description, deduplicated. */
  terms: string[];
  /** mtime of SKILL.md in ms, used for cache invalidation. */
  mtimeMs: number;
}

/**
 * Why a skill matched.
 * - "trigger": a "use when ..." phrase from the skill's own description matched.
 * - "regex":   a user-configured regex from config.triggers matched.
 * - "terms":   IDF-weighted term overlap between prompt and skill.
 * - "context": a signal from the working directory matched.
 */
export type MatchReasonKind = "trigger" | "regex" | "terms" | "context";

export interface MatchReason {
  kind: MatchReasonKind;
  detail: string;
}

export interface RankedMatch {
  skill: SkillRecord;
  /** Normalised 0..1. */
  score: number;
  reasons: MatchReason[];
}

export interface ScoreSignals {
  prompt: string;
  /** File extensions present in cwd, without the dot, e.g. ["ts", "md"]. */
  cwdExtensions: string[];
}

export interface GateConfig {
  tools: string[];
}

export interface EscalateConfig {
  enabled: boolean;
  /** Model id to consult, or null to use the session's active model. */
  model: string | null;
}

export interface CueConfig {
  enabled: boolean;
  maxSkills: number;
  /** Minimum normalised score required to inject. */
  threshold: number;
  /** When true, the injected directive is also shown as a session message. */
  verbose: boolean;
  /** Skill names never injected and never gated. */
  mute: string[];
  /** Skill name → regex source strings that force a match. */
  triggers: Record<string, string[]>;
  /** Skill name → gate configuration. */
  gates: Record<string, GateConfig>;
  escalate: EscalateConfig;
}

/**
 * A fresh config with independent children. Callers that merge over defaults MUST use this
 * rather than spreading DEFAULT_CONFIG: a shallow spread shares `mute`, `triggers`, `gates`,
 * and `escalate` by reference, so one mutation would corrupt defaults for every session.
 */
export function createDefaultConfig(): CueConfig {
  return {
    enabled: true,
    maxSkills: 3,
    threshold: 0.35,
    verbose: false,
    mute: [],
    triggers: {},
    gates: {},
    escalate: { enabled: false, model: null },
  };
}

/** Convenience snapshot for reads and assertions. Never mutate it; call createDefaultConfig() to own a copy. */
export const DEFAULT_CONFIG: CueConfig = createDefaultConfig();

export type LedgerEvent =
  | {
      type: "inject";
      ts: number;
      session: string;
      skill: string;
      score: number;
      /** `detail` of the highest-weighted MatchReason, e.g. the matched "use when" phrase. */
      reason: string;
    }
  | { type: "read"; ts: number; session: string; skill: string }
  | { type: "block"; ts: number; session: string; skill: string; tool: string }
  | { type: "error"; ts: number; session: string; where: string; message: string };

export interface SkillStats {
  injections: number;
  reads: number;
  blocks: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add shared types and advisory-only default config"
```

---

### Task 3: Text utilities — tokenising and trigger extraction

The scorer needs deterministic tokenising and needs to find the "use when" clauses that skill authors already write. This is the highest-signal input to routing, so it gets its own tested unit.

**Files:**
- Create: `src/text.ts`
- Test: `tests/text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/text.test.ts
import { describe, expect, it } from "vitest";
import { extractTriggerPhrases, tokenize } from "../src/text.js";

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, and drops short tokens", () => {
    expect(tokenize("Fix the Login-Bug in api_v2")).toEqual(["fix", "login", "bug", "api"]);
  });

  it("drops filler but keeps domain words", () => {
    expect(tokenize("please help me refactor the authentication module")).toEqual([
      "refactor",
      "authentication",
      "module",
    ]);
  });

  it("folds diacritics instead of shredding accented words into fragments", () => {
    expect(tokenize("naïve café résumé")).toEqual(["naive", "cafe", "resume"]);
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

  it("requires a word boundary, so 'misuse when' is not a lead", () => {
    expect(extractTriggerPhrases("Misuse when handling authentication flows")).toEqual([]);
  });

  it("truncates a clause at the end of its sentence", () => {
    expect(extractTriggerPhrases("Use when debugging failures. Do not use otherwise.")).toEqual([
      "debugging failures",
    ]);
  });

  it("keeps clauses from separate leads from bleeding into each other", () => {
    expect(extractTriggerPhrases("Use when refactoring modules, use when renaming symbols")).toEqual([
      "refactoring modules",
      "renaming symbols",
    ]);
  });

  it("deduplicates a clause repeated across sentences", () => {
    expect(extractTriggerPhrases("Use when creating a theme. Use when creating a theme.")).toEqual([
      "creating a theme",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/text.test.ts`
Expected: FAIL — cannot find module `../src/text.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Grammatical filler only. Domain-common words (code, file, test) are deliberately NOT here:
// the scorer weights terms by inverse document frequency, so words common across the whole
// skill catalogue already contribute nearly nothing. Removing them here would instead destroy
// the signal for skills that are genuinely about code or files.
const STOPWORDS = new Set([
  "the", "this", "that", "these", "those", "and", "for", "with", "when", "use",
  "using", "used", "any", "all", "you", "your", "are", "was", "were", "has",
  "have", "had", "not", "but", "can", "will", "should", "would", "into", "from",
  "before", "after", "then", "than", "them", "they", "its", "our", "out", "get",
  "let", "one", "two", "how", "why", "what", "which", "who", "whom",
  "please", "help", "make", "need", "want", "like", "just",
  "some", "more", "most", "other", "also", "about", "over", "under", "very",
]);

const MIN_TOKEN_LENGTH = 3;

/** Clauses shorter than this are placeholders like "x, or y" that would match almost any prompt. */
const MIN_PHRASE_LENGTH = 5;

/**
 * Deterministic tokeniser. Folds diacritics so accented text yields whole words rather than
 * fragments, then keeps alphanumeric runs that are neither too short nor pure filler.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}

/** Word-bounded so "misuse when" and "reuse when" do not produce phantom leads. */
const TRIGGER_LEAD = /\b(?:use|apply|activate|invoke)\s+(?:this\s+)?(?:skill\s+)?when\s+/gi;
const CLAUSE_END = /[.!?](?:\s|$)|;|\n/;
const LEADING_WHEN = /^when\s+/;

/**
 * Extract trigger phrases from a skill description. Skill authors conventionally write
 * "Use when X, Y, or Z"; each comma- or "or"-separated clause becomes a phrase.
 *
 * Each lead's text is truncated at the next lead, so a description with several "use when"
 * clauses yields clean phrases instead of ones containing the following lead's words.
 */
export function extractTriggerPhrases(description: string): string[] {
  const phrases: string[] = [];
  const matches = [...description.matchAll(TRIGGER_LEAD)];

  for (const [index, match] of matches.entries()) {
    if (match.index === undefined) continue;
    const start = match.index + match[0].length;
    const nextLead = matches[index + 1]?.index ?? description.length;
    const segment = description.slice(start, nextLead).toLowerCase();
    const tail = segment.split(CLAUSE_END)[0] ?? segment;

    for (const raw of tail.split(/,\s*(?:or\s+)?|\s+or\s+/)) {
      const phrase = raw.trim().replace(LEADING_WHEN, "").replace(/[.:;!?]+$/, "").trim();
      if (phrase.length >= MIN_PHRASE_LENGTH) phrases.push(phrase);
    }
  }

  return [...new Set(phrases)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/text.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/text.ts tests/text.test.ts
git commit -m "feat: add tokeniser and trigger-phrase extraction"
```

---

### Task 4: Config loading and merge

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

  it("keeps the lower layer when every entry in the upper layer is invalid", () => {
    const merged = mergeConfig(
      { gates: { alpha: { tools: ["write"] } } },
      { gates: { beta: { tools: "write" } } } as never,
    );
    expect(merged.gates).toEqual({ alpha: { tools: ["write"] } });
  });

  it("honours an explicitly emptied gates object as a deliberate clear", () => {
    const merged = mergeConfig({ gates: { alpha: { tools: ["write"] } } }, { gates: {} });
    expect(merged.gates).toEqual({});
  });

  it("drops an unparseable regex but keeps the valid patterns beside it", () => {
    const merged = mergeConfig({ triggers: { alpha: ["([unclosed", "\\bABC-\\d+\\b"] } }, undefined);
    expect(merged.triggers).toEqual({ alpha: ["\\bABC-\\d+\\b"] });
  });

  it("drops a trigger entry whose every pattern is unparseable", () => {
    const merged = mergeConfig({ triggers: { alpha: ["([unclosed"] } }, undefined);
    expect(merged.triggers).toEqual({});
  });

  it("rejects a record supplied as an array instead of inventing numeric keys", () => {
    const merged = mergeConfig({ gates: [{ tools: ["write"] }] } as never, undefined);
    expect(merged.gates).toEqual({});
  });

  it("ignores prototype keys instead of polluting the result's prototype", () => {
    const merged = mergeConfig(JSON.parse('{"gates":{"__proto__":{"tools":["write"]}}}'), undefined);
    expect(merged.gates).toEqual({});
    expect(Object.getPrototypeOf(merged.gates)).toEqual(Object.prototype);
  });

  it("normalises a non-string escalate model to null", () => {
    expect(mergeConfig({ escalate: { enabled: true, model: 7 } } as never, undefined).escalate).toEqual({
      enabled: true,
      model: null,
    });
  });

  it("truncates a fractional maxSkills", () => {
    expect(mergeConfig({ maxSkills: 2.7 }, undefined).maxSkills).toBe(2);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync } from "node:fs";
import { createDefaultConfig, type CueConfig, type GateConfig } from "./types.js";

type PartialConfig = Partial<CueConfig>;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeGates(value: unknown): Record<string, GateConfig> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return {};
  const out: Record<string, GateConfig> = {};
  // Rebuilt field by field: extend this when the shape grows.
  for (const [name, gate] of entries) {
    if (RESERVED_KEYS.has(name)) continue;
    const tools = (gate as GateConfig | undefined)?.tools;
    if (isStringArray(tools) && tools.length > 0) out[name] = { tools };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeTriggers(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return {};
  const out: Record<string, string[]> = {};
  // Rebuilt field by field: extend this when the shape grows.
  for (const [name, patterns] of entries) {
    if (RESERVED_KEYS.has(name)) continue;
    if (!isStringArray(patterns)) continue;
    const valid = patterns.filter((p) => {
      try {
        new RegExp(p, "i");
        return true;
      } catch {
        return false;
      }
    });
    if (valid.length > 0) out[name] = valid;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validate one layer, dropping anything malformed. Unknown keys are discarded. */
function sanitize(raw: unknown): PartialConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: PartialConfig = {};

  if (typeof input.enabled === "boolean") out.enabled = input.enabled;
  if (typeof input.verbose === "boolean") out.verbose = input.verbose;
  // 1..10 inclusive: more than a handful of injected skills is noise.
  if (typeof input.maxSkills === "number" && input.maxSkills >= 1 && input.maxSkills <= 10) {
    out.maxSkills = Math.floor(input.maxSkills);
  }
  // Exclusive bounds: 0 would inject on every prompt, 1 could never match.
  if (typeof input.threshold === "number" && input.threshold > 0 && input.threshold < 1) {
    out.threshold = input.threshold;
  }
  if (isStringArray(input.mute)) out.mute = input.mute;

  const gates = sanitizeGates(input.gates);
  if (gates) out.gates = gates;

  const triggers = sanitizeTriggers(input.triggers);
  if (triggers) out.triggers = triggers;

  const escalate = input.escalate;
  if (typeof escalate === "object" && escalate !== null && !Array.isArray(escalate)) {
    const fields = escalate as Record<string, unknown>;
    if (typeof fields.enabled === "boolean") {
      out.escalate = {
        enabled: fields.enabled,
        model: typeof fields.model === "string" ? fields.model : null,
      };
    }
  }

  return out;
}

/** Merge per top-level key. A key present in the project layer replaces the global value. */
export function mergeConfig(globalRaw: unknown, projectRaw: unknown): CueConfig {
  // createDefaultConfig(), not a spread of DEFAULT_CONFIG: the caller must own its children.
  return { ...createDefaultConfig(), ...sanitize(globalRaw), ...sanitize(projectRaw) };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function loadConfig(globalPath: string, projectPath: string): CueConfig {
  return mergeConfig(readJson(globalPath), readJson(projectPath));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loading with per-key merge and invalid-value fallback"
```

---

### Task 5: Catalog

Pi hands the extension a list of loaded skills. This unit normalises them into `SkillRecord[]`, reading each `SKILL.md` for a description when one is not supplied, and caching by mtime so repeated turns cost nothing.

**Files:**
- Create: `src/catalog.ts`
- Test: `tests/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/catalog.test.ts`
Expected: FAIL — cannot find module `../src/catalog.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync, statSync } from "node:fs";
import { extractTriggerPhrases, tokenize } from "./text.js";
import type { SkillRecord } from "./types.js";

/** The subset of pi's loaded-skill shape this package relies on. */
export interface SkillInput {
  name: string;
  path: string;
  description?: string;
}

export interface ParsedSkill {
  name: string;
  description: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return quoted?.[2] ?? trimmed;
}

/** Read name and description from a SKILL.md. Returns undefined on any failure. */
export function parseSkillFile(path: string): ParsedSkill | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  const block = FRONTMATTER.exec(raw.replace(/^\uFEFF/, ""))?.[1];
  if (!block) return undefined;

  const lines = block.split(/\r?\n/);
  let name = "";
  let description = "";

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(name|description):\s*(.*)$/.exec(lines[index] ?? "");
    if (!match) continue;

    let value = unquote(match[2] ?? "");
    // A block scalar indicator (or nothing) means the value is the indented lines that follow.
    if (value === "" || value === ">" || value === ">-" || value === "|" || value === "|-") {
      const continuation: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        if (next.trim() === "") {
          index += 1;
          continue;
        }
        if (!/^\s/.test(next)) break;
        continuation.push(next.trim());
        index += 1;
      }
      value = continuation.join(" ").trim();
    }

    if (match[1] === "name") name = value;
    else description = value;
  }

  if (!name) return undefined;
  return { name, description };
}

/**
 * Routing fields derived from a skill's name and description. Exported so tests and any other
 * consumer derive them the same way `makeRecord` does, rather than duplicating the rule.
 */
export function deriveRoutingFields(
  name: string,
  description: string,
): { triggerPhrases: string[]; terms: string[] } {
  return {
    triggerPhrases: extractTriggerPhrases(description),
    terms: [...new Set(tokenize(`${name} ${description}`))],
  };
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  description: string | undefined;
  record: SkillRecord;
}

const cache = new Map<string, CacheEntry>();

/** Exposed for tests that need a cold cache. */
export function clearCatalogCache(): void {
  cache.clear();
}

function makeRecord(input: SkillInput, mtimeMs: number): SkillRecord | undefined {
  const parsed = parseSkillFile(input.path);
  const description = input.description ?? parsed?.description ?? "";
  const name = input.name || parsed?.name || "";
  if (!name) return undefined;
  // A skill with neither a parseable file nor a description from pi has nothing to route on.
  if (!parsed && !input.description) return undefined;

  // A parseable skill with an empty description is kept deliberately: it cannot match, and the
  // doctor reports exactly that. Dropping it here would hide the problem from the user.
  const record: SkillRecord = {
    name,
    path: input.path,
    description,
    ...deriveRoutingFields(name, description),
    mtimeMs,
  };

  Object.freeze(record.triggerPhrases);
  Object.freeze(record.terms);
  return Object.freeze(record);
}

/**
 * Normalise pi's loaded skills into routing records. Cached by path, invalidated when the file's
 * mtime or size changes or pi reports a different description. Unparseable skills are dropped,
 * and entries for skills no longer present are evicted so a long session does not accumulate them.
 */
export function buildCatalog(inputs: SkillInput[]): SkillRecord[] {
  const records: SkillRecord[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    let mtimeMs: number;
    let size: number;
    try {
      const stats = statSync(input.path);
      mtimeMs = stats.mtimeMs;
      size = stats.size;
    } catch {
      continue;
    }

    seen.add(input.path);
    const cached = cache.get(input.path);
    if (
      cached &&
      cached.mtimeMs === mtimeMs &&
      cached.size === size &&
      cached.description === input.description
    ) {
      records.push(cached.record);
      continue;
    }

    const record = makeRecord(input, mtimeMs);
    if (!record) {
      cache.delete(input.path);
      continue;
    }

    cache.set(input.path, { mtimeMs, size, description: input.description, record });
    records.push(record);
  }

  for (const key of [...cache.keys()]) {
    if (!seen.has(key)) cache.delete(key);
  }

  return records;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/catalog.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/catalog.ts tests/catalog.test.ts
git commit -m "feat: add mtime-cached skill catalog with fail-soft parsing"
```

---

### Task 6: Scorer

The engine. Pure, deterministic, normalised to 0..1 so `threshold` means the same thing at any catalogue size.

**Files:**
- Create: `src/scorer.ts`
- Test: `tests/scorer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { deriveRoutingFields } from "../src/catalog.js";
import { scoreSkills } from "../src/scorer.js";
import { DEFAULT_CONFIG, type CueConfig, type SkillRecord } from "../src/types.js";

function record(name: string, description: string): SkillRecord {
  return {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description,
    triggerPhrases: [],
    terms: [],
    mtimeMs: 1,
  };
}

/** Mirrors what buildCatalog derives, via the same function it uses. */
function withDerived(r: SkillRecord): SkillRecord {
  return { ...r, ...deriveRoutingFields(r.name, r.description) };
}

const catalog: SkillRecord[] = [
  record("systematic-debugging", "Use when encountering a failing test or unexpected behaviour, before proposing fixes"),
  record("banner-design", "Use when designing banners for social media, ads, or website heroes"),
  record("ticket-workflow", "Use when the user references a tracked work item by key"),
  record("config-audit", "Use when reviewing json configuration files"),
].map(withDerived);

const signals = (prompt: string) => ({ prompt, cwdExtensions: [] as string[] });

describe("scoreSkills", () => {
  it("ranks a trigger-phrase match above unrelated skills", () => {
    const matches = scoreSkills(catalog, signals("I have a failing test and no idea why"), DEFAULT_CONFIG);
    expect(matches[0]?.skill.name).toBe("systematic-debugging");
    expect(matches[0]?.reasons.some((r) => r.kind === "trigger")).toBe(true);
  });

  it("normalises every score into 0..1", () => {
    const matches = scoreSkills(catalog, signals("designing banners for ads"), DEFAULT_CONFIG);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns nothing when no skill clears the threshold", () => {
    expect(scoreSkills(catalog, signals("what time is it"), DEFAULT_CONFIG)).toEqual([]);
  });

  it("lets a configured regex trigger outrank lexical similarity", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, triggers: { "ticket-workflow": ["\\b[A-Z]{2,}-\\d{3,}\\b"] } };
    const matches = scoreSkills(catalog, signals("take a look at ABC-1234 please"), config);
    expect(matches[0]?.skill.name).toBe("ticket-workflow");
    expect(matches[0]?.score).toBeGreaterThan(0.9);
    expect(matches[0]?.reasons.some((r) => r.kind === "regex")).toBe(true);
  });

  it("honours maxSkills", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const prompt = signals("failing test while designing banners");
    expect(scoreSkills(catalog, prompt, permissive).length).toBeGreaterThan(1);
    expect(scoreSkills(catalog, prompt, { ...permissive, maxSkills: 1 })).toHaveLength(1);
  });

  it("never returns a muted skill", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, mute: ["systematic-debugging"] };
    const names = scoreSkills(catalog, signals("I have a failing test"), config).map((m) => m.skill.name);
    expect(names).not.toContain("systematic-debugging");
  });

  it("weights rare terms above terms common to the whole catalogue", () => {
    const shared = [
      record("alpha", "Use when handling widget calibration routines"),
      record("beta", "Use when handling widget shipping logistics"),
    ].map(withDerived);
    const matches = scoreSkills(shared, signals("calibration of a widget"), { ...DEFAULT_CONFIG, threshold: 0.01 });
    expect(matches[0]?.skill.name).toBe("alpha");
  });

  it("breaks a score tie alphabetically regardless of input order", () => {
    const pair = [
      record("zeta-skill", "Use when handling identical twin descriptions"),
      record("alpha-skill", "Use when handling identical twin descriptions"),
    ].map(withDerived);
    const matches = scoreSkills(pair, signals("handling identical twin descriptions"), {
      ...DEFAULT_CONFIG,
      threshold: 0.01,
    });
    expect(matches.map((m) => m.skill.name)).toEqual(["alpha-skill", "zeta-skill"]);
  });

  it("returns an empty array for an empty catalogue", () => {
    expect(scoreSkills([], signals("anything at all"), DEFAULT_CONFIG)).toEqual([]);
  });

  it("adds a context reason when a working-directory extension matches a skill term", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const withContext = scoreSkills(catalog, { prompt: "check the configuration", cwdExtensions: ["json"] }, permissive);
    const withoutContext = scoreSkills(catalog, { prompt: "check the configuration", cwdExtensions: [] }, permissive);
    const hit = withContext.find((m) => m.skill.name === "config-audit");
    const base = withoutContext.find((m) => m.skill.name === "config-audit");
    expect(hit?.reasons.some((r) => r.kind === "context")).toBe(true);
    expect(hit?.score ?? 0).toBeGreaterThan(base?.score ?? 0);
  });

  it("does not treat a short extension as a substring of a skill's words", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const matches = scoreSkills(catalog, { prompt: "make me a banner", cwdExtensions: ["rs"] }, permissive);
    const banner = matches.find((m) => m.skill.name === "banner-design");
    expect(banner?.reasons.some((r) => r.kind === "context") ?? false).toBe(false);
  });

  it("clamps a score that would otherwise exceed one", () => {
    const permissive: CueConfig = { ...DEFAULT_CONFIG, threshold: 0.01 };
    const matches = scoreSkills(
      catalog,
      { prompt: "reviewing json configuration files", cwdExtensions: ["json"] },
      permissive,
    );
    expect(matches.find((m) => m.skill.name === "config-audit")?.score).toBe(1);
  });

  it("does not let a partial phrase match fire on a word that merely contains a trigger word", () => {
    const only = [record("failing-test-triage", "Use when a test is failing")].map(withDerived);
    const matches = scoreSkills(only, signals("the latest contest results"), { ...DEFAULT_CONFIG, threshold: 0.01 });
    expect(matches.some((m) => m.reasons.some((r) => r.kind === "trigger"))).toBe(false);
  });

  it("ignores an unparseable configured regex instead of throwing", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, triggers: { "ticket-workflow": ["([unclosed"] } };
    expect(() => scoreSkills(catalog, signals("take a look at ABC-1234"), config)).not.toThrow();
    const names = scoreSkills(catalog, signals("unrelated chatter entirely"), config).map((m) => m.skill.name);
    expect(names).not.toContain("ticket-workflow");
  });

  it("muting a skill does not change the scores of the skills that remain", () => {
    const prompt = signals("I have a failing test");
    const before = scoreSkills(catalog, prompt, { ...DEFAULT_CONFIG, threshold: 0.01 });
    const after = scoreSkills(catalog, prompt, { ...DEFAULT_CONFIG, threshold: 0.01, mute: ["banner-design"] });
    const scoreOf = (list: typeof before, name: string) => list.find((m) => m.skill.name === name)?.score;
    expect(scoreOf(after, "systematic-debugging")).toBe(scoreOf(before, "systematic-debugging"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scorer.test.ts`
Expected: FAIL — cannot find module `../src/scorer.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { tokenize } from "./text.js";
import type { CueConfig, MatchReason, RankedMatch, ScoreSignals, SkillRecord } from "./types.js";

/** Weight of a matched "use when" phrase from the skill's own description. */
const WEIGHT_TRIGGER = 0.55;
/** Weight of IDF-weighted term overlap between the prompt and the skill. */
const WEIGHT_TERMS = 0.45;
/** Bonus when a working-directory signal agrees. Deliberately small: it is weak evidence. */
const WEIGHT_CONTEXT = 0.1;
/** A user-configured regex is a declaration of certainty, so it outranks anything inferred. */
const REGEX_SCORE = 1;
/** A phrase counts as matched when this fraction of its significant words appear in the prompt. */
const PARTIAL_PHRASE_RATIO = 0.6;
/**
 * Weight given to a prompt term that appears nowhere in the catalogue. Such a term can never be
 * matched, so it only dilutes the denominator; this keeps that dilution bounded and explicit.
 */
const UNKNOWN_TERM_IDF = Math.log(2);

/**
 * Inverse document frequency across the whole catalogue, so terms common to every skill
 * contribute almost nothing. Computed over all records, including muted ones, so muting a skill
 * cannot shift the scores of the skills that remain.
 */
function buildIdf(records: readonly SkillRecord[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const record of records) {
    // SkillRecord.terms is already deduplicated by deriveRoutingFields.
    for (const term of record.terms) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) idf.set(term, Math.log(1 + records.length / (1 + df)));
  return idf;
}

/** Compile configured patterns once per call rather than once per skill per prompt. */
function compileTriggers(config: CueConfig): Map<string, RegExp[]> {
  const compiled = new Map<string, RegExp[]>();
  for (const [name, sources] of Object.entries(config.triggers)) {
    const regexes: RegExp[] = [];
    for (const source of sources) {
      try {
        regexes.push(new RegExp(source, "i"));
      } catch {
        // A malformed pattern can never match. config.ts drops these, but scoreSkills may be
        // called with a hand-built config, so it must not throw.
      }
    }
    if (regexes.length > 0) compiled.set(name, regexes);
  }
  return compiled;
}

function termRatio(
  promptTerms: ReadonlySet<string>,
  record: SkillRecord,
  idf: Map<string, number>,
): number {
  if (promptTerms.size === 0) return 0;

  const skillTerms = new Set(record.terms);
  let matched = 0;
  let possible = 0;
  for (const term of promptTerms) {
    const weight = idf.get(term) ?? UNKNOWN_TERM_IDF;
    possible += weight;
    if (skillTerms.has(term)) matched += weight;
  }

  return possible === 0 ? 0 : matched / possible;
}

/**
 * A trigger phrase matches either verbatim in the prompt, or when enough of its significant
 * words appear as prompt TOKENS. Token comparison matters: substring comparison would let
 * "test" match "latest".
 */
function matchTriggerPhrase(
  prompt: string,
  promptTerms: ReadonlySet<string>,
  record: SkillRecord,
): string | undefined {
  const haystack = prompt.toLowerCase();
  for (const phrase of record.triggerPhrases) {
    if (haystack.includes(phrase)) return phrase;

    const words = tokenize(phrase);
    if (words.length < 2) continue;
    const present = words.filter((word) => promptTerms.has(word)).length;
    if (present / words.length >= PARTIAL_PHRASE_RATIO) return phrase;
  }
  return undefined;
}

function matchConfiguredRegex(
  prompt: string,
  name: string,
  compiled: Map<string, RegExp[]>,
): string | undefined {
  for (const regex of compiled.get(name) ?? []) {
    if (regex.test(prompt)) return regex.source;
  }
  return undefined;
}

/**
 * A working-directory extension matches only as a whole skill term. Substring comparison here
 * scored "banner-design" for a Rust project, because "banners" contains "rs". Extensions shorter
 * than a routing term (tokenize drops anything under three characters) therefore never match,
 * which is deliberate: "ts", "go" and "rs" are too ambiguous to be evidence.
 */
function matchCwdExtension(record: SkillRecord, signals: ScoreSignals): string | undefined {
  const terms = new Set(record.terms);
  for (const extension of signals.cwdExtensions) {
    if (terms.has(extension.toLowerCase())) return extension;
  }
  return undefined;
}

/**
 * Rank skills against a prompt. Pure: no I/O, no clock, no state.
 * Scores are normalised to 0..1 so `config.threshold` is stable across catalogue sizes.
 */
export function scoreSkills(
  records: SkillRecord[],
  signals: ScoreSignals,
  config: CueConfig,
): RankedMatch[] {
  if (records.length === 0) return [];

  const idf = buildIdf(records);
  const compiled = compileTriggers(config);
  const promptTerms = new Set(tokenize(signals.prompt));
  const muted = new Set(config.mute);
  const matches: RankedMatch[] = [];

  for (const skill of records) {
    if (muted.has(skill.name)) continue;

    const reasons: MatchReason[] = [];

    const regex = matchConfiguredRegex(signals.prompt, skill.name, compiled);
    if (regex) reasons.push({ kind: "regex", detail: regex });

    const trigger = matchTriggerPhrase(signals.prompt, promptTerms, skill);
    if (trigger) reasons.push({ kind: "trigger", detail: trigger });

    const ratio = termRatio(promptTerms, skill, idf);
    if (ratio > 0) reasons.push({ kind: "terms", detail: `term overlap ${ratio.toFixed(2)}` });

    const context = matchCwdExtension(skill, signals);
    if (context) reasons.push({ kind: "context", detail: `${context} files in cwd` });

    let score = (trigger ? WEIGHT_TRIGGER : 0) + WEIGHT_TERMS * ratio + (context ? WEIGHT_CONTEXT : 0);
    if (regex) score = Math.max(score, REGEX_SCORE);
    score = Math.min(1, score);

    if (score >= config.threshold) matches.push({ skill, score, reasons });
  }

  matches.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return matches.slice(0, config.maxSkills);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scorer.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scorer.ts tests/scorer.test.ts
git commit -m "feat: add pure normalised skill scorer with IDF weighting and regex triggers"
```

---

### Task 7: Injector

**Files:**
- Create: `src/injector.ts`
- Test: `tests/injector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildDirective, MAX_DIRECTIVE_CHARS } from "../src/injector.js";
import type { RankedMatch, SkillRecord } from "../src/types.js";

function match(name: string, detail = "some trigger phrase"): RankedMatch {
  const skill: SkillRecord = {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description: `Use when ${detail}`,
    triggerPhrases: [detail],
    terms: [name],
    mtimeMs: 1,
  };
  return { skill, score: 0.8, reasons: [{ kind: "trigger", detail }] };
}

describe("buildDirective", () => {
  it("returns undefined when there are no matches", () => {
    expect(buildDirective([], new Set())).toBeUndefined();
  });

  it("names the skill and its absolute path", () => {
    const text = buildDirective([match("alpha")], new Set());
    expect(text).toContain("`alpha`");
    expect(text).toContain("/fixtures/alpha/SKILL.md");
  });

  it("states the reason so a user can debug a bad match", () => {
    expect(buildDirective([match("alpha", "reviewing a pull request")], new Set()))
      .toContain("reviewing a pull request");
  });

  it("omits skills already read this session", () => {
    const text = buildDirective([match("alpha"), match("beta")], new Set(["alpha"]));
    expect(text).not.toContain("`alpha`");
    expect(text).toContain("`beta`");
  });

  it("returns undefined when every match was already read", () => {
    expect(buildDirective([match("alpha")], new Set(["alpha"]))).toBeUndefined();
  });

  it("drops the lowest-ranked matches when the budget is reached", () => {
    // Each line renders name and path, so a long name makes one line exceed a third of the budget.
    const wide = (name: string) => match(name.padEnd(160, "-"));
    const text = buildDirective([wide("alpha"), wide("beta"), wide("gamma")], new Set()) ?? "";

    expect(text.length).toBeLessThanOrEqual(MAX_DIRECTIVE_CHARS);
    expect(text).toContain("alpha");
    expect(text).not.toContain("gamma");
  });

  it("truncates an over-long reason rather than the match list", () => {
    const text = buildDirective([match("alpha", "x".repeat(400))], new Set()) ?? "";
    expect(text).toContain("...");
    expect(text.length).toBeLessThanOrEqual(MAX_DIRECTIVE_CHARS);
    expect(text).toContain("`alpha`");
  });

  it("preserves the ranking order it was given", () => {
    const text = buildDirective([match("beta"), match("alpha")], new Set()) ?? "";
    expect(text.indexOf("`beta`")).toBeLessThan(text.indexOf("`alpha`"));
  });

  it("falls back to a generic reason when a match carries none", () => {
    const bare: RankedMatch = { ...match("alpha"), reasons: [] };
    expect(buildDirective([bare], new Set())).toContain("lexical match");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/injector.test.ts`
Expected: FAIL — cannot find module `../src/injector.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RankedMatch } from "./types.js";

export const MAX_DIRECTIVE_CHARS = 600;

/** Longest reason we render. Anything longer is usually a whole "use when" sentence. */
const MAX_REASON_CHARS = 80;
const ELLIPSIS = "...";

const HEADER = "## Skill matches for this request";
const FOOTER =
  "Read the matching SKILL.md before acting. If a match is irrelevant to what was asked, ignore it and continue.";

function renderMatchLine(match: RankedMatch): string {
  const reason = match.reasons[0]?.detail ?? "lexical match";
  const trimmed =
    reason.length > MAX_REASON_CHARS
      ? `${reason.slice(0, MAX_REASON_CHARS - ELLIPSIS.length)}${ELLIPSIS}`
      : reason;
  return `- \`${match.skill.name}\` (${match.skill.path}) — matched: ${trimmed}`;
}

/**
 * Render ranked matches into a directive appended to the turn's system prompt.
 *
 * `matches` must be ordered best-first and already filtered by `scoreSkills`; when the character
 * budget is reached the lowest-ranked entries are dropped. `reasons[0]` is assumed to be the
 * highest-weighted reason, which is what `scoreSkills` produces.
 *
 * Skills already read this session are omitted: repeating them trains the model to ignore the block.
 */
export function buildDirective(
  matches: readonly RankedMatch[],
  alreadyRead: ReadonlySet<string>,
): string | undefined {
  const fresh = matches.filter((match) => !alreadyRead.has(match.skill.name));
  if (fresh.length === 0) return undefined;

  const lines: string[] = [];
  for (const match of fresh) {
    // Measure the candidate output rather than predicting its length: the input is capped at
    // config.maxSkills, so the repeated joins cost nothing and cannot drift out of step.
    const candidate = [HEADER, ...lines, renderMatchLine(match), FOOTER].join("\n");
    if (candidate.length > MAX_DIRECTIVE_CHARS) break;
    lines.push(renderMatchLine(match));
  }

  if (lines.length === 0) return undefined;
  return [HEADER, ...lines, FOOTER].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/injector.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/injector.ts tests/injector.test.ts
git commit -m "feat: add budget-capped directive injector with per-session dedupe"
```

---

### Task 8: Gatekeeper

**Files:**
- Create: `src/gatekeeper.ts`
- Test: `tests/gatekeeper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { Gatekeeper } from "../src/gatekeeper.js";
import { DEFAULT_CONFIG, type CueConfig, type SkillRecord } from "../src/types.js";

const tdd: SkillRecord = {
  name: "test-driven-development",
  path: "/fixtures/test-driven-development/SKILL.md",
  description: "Use when implementing any feature or bugfix",
  triggerPhrases: ["implementing any feature"],
  terms: ["test", "driven", "development"],
  mtimeMs: 1,
};

function gated(): CueConfig {
  return {
    ...DEFAULT_CONFIG,
    gates: { "test-driven-development": { tools: ["write", "edit"] } },
  };
}

describe("Gatekeeper", () => {
  it("does not block when no gates are configured", () => {
    expect(new Gatekeeper(DEFAULT_CONFIG, [tdd]).check("write")).toBeUndefined();
  });

  it("blocks a guarded tool while the gate is unsatisfied", () => {
    const result = new Gatekeeper(gated(), [tdd]).check("write");
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("test-driven-development");
    expect(result?.reason).toContain("/fixtures/test-driven-development/SKILL.md");
  });

  it("leaves unguarded tools alone", () => {
    expect(new Gatekeeper(gated(), [tdd]).check("read")).toBeUndefined();
  });

  it("stops blocking once the skill file is read", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/test-driven-development/SKILL.md");
    expect(keeper.check("write")).toBeUndefined();
  });

  it("accepts satisfaction by skill name for /skill: invocations", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.markSatisfied("test-driven-development");
    expect(keeper.check("write")).toBeUndefined();
  });

  it("ignores a read of an unrelated file", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/other/SKILL.md");
    expect(keeper.check("write")?.block).toBe(true);
  });

  it("releases on the third consecutive block of the same tool", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    expect(keeper.check("write")?.block).toBe(true);
    expect(keeper.check("write")?.block).toBe(true);
    expect(keeper.check("write")).toBeUndefined();
  });

  it("counts blocks per tool, not globally", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.check("write");
    keeper.check("write");
    expect(keeper.check("edit")?.block).toBe(true);
  });

  it("ignores a gate naming a skill that is not installed", () => {
    const config: CueConfig = { ...DEFAULT_CONFIG, gates: { absent: { tools: ["write"] } } };
    expect(new Gatekeeper(config, [tdd]).check("write")).toBeUndefined();
  });

  it("never gates a muted skill", () => {
    const config: CueConfig = { ...gated(), mute: ["test-driven-development"] };
    expect(new Gatekeeper(config, [tdd]).check("write")).toBeUndefined();
  });

  it("reports which skills have been read for injector dedupe", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/test-driven-development/SKILL.md");
    expect(keeper.satisfiedSkills()).toEqual(new Set(["test-driven-development"]));
  });

  it("stops blocking permanently once it releases", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    expect(keeper.check("write")?.block).toBe(true);
    expect(keeper.check("write")?.block).toBe(true);
    expect(keeper.check("write")).toBeUndefined();
    expect(keeper.check("write")).toBeUndefined();
    expect(keeper.check("write")).toBeUndefined();
  });

  it("accepts a differently written path for the same file", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/test-driven-development/../test-driven-development/SKILL.md");
    expect(keeper.check("write")).toBeUndefined();
  });

  it("does not satisfy a gate by reading another file inside the skill's directory", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.noteRead("/fixtures/test-driven-development/references/details.md");
    expect(keeper.check("write")?.block).toBe(true);
  });

  it("never blocks while the extension is disabled", () => {
    const keeper = new Gatekeeper({ ...gated(), enabled: false }, [tdd]);
    expect(keeper.check("write")).toBeUndefined();
  });

  it("reports a skill satisfied by a /skill: invocation as satisfied", () => {
    const keeper = new Gatekeeper(gated(), [tdd]);
    keeper.markSatisfied("test-driven-development");
    expect(keeper.satisfiedSkills()).toEqual(new Set(["test-driven-development"]));
  });

  it("lets the first gate in config order win when two guard the same tool", () => {
    const other: SkillRecord = { ...tdd, name: "brainstorming", path: "/fixtures/brainstorming/SKILL.md" };
    const config: CueConfig = {
      ...DEFAULT_CONFIG,
      gates: {
        "test-driven-development": { tools: ["write"] },
        brainstorming: { tools: ["write"] },
      },
    };
    const keeper = new Gatekeeper(config, [tdd, other]);
    expect(keeper.check("write")?.skill).toBe("test-driven-development");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gatekeeper.test.ts`
Expected: FAIL — cannot find module `../src/gatekeeper.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { resolve } from "node:path";
import type { CueConfig, SkillRecord } from "./types.js";

export interface BlockDecision {
  block: true;
  reason: string;
  skill: string;
}

/**
 * Blocks of one tool by one gate before that gate gives up for the rest of the session.
 * Releasing permanently is deliberate: a gate is a nudge with teeth, not a security control, and
 * an agent that can be blocked indefinitely burns tokens and user trust. Note the cost is per
 * gate, so two unsatisfied gates on the same tool can block it this many times each.
 */
const RELEASE_AFTER = 2;

/** Composite key for the per-gate, per-tool block counter. */
function gateKey(skill: string, tool: string): string {
  return `${skill}\u0000${tool}`;
}

/** Per-session gate state. One instance per pi session. */
export class Gatekeeper {
  private readonly satisfied = new Set<string>();
  private readonly blocksByGateTool = new Map<string, number>();
  private readonly byResolvedPath = new Map<string, string>();
  /** Skills eligible to gate: installed, and not muted. */
  private readonly gateable = new Map<string, SkillRecord>();

  constructor(
    private readonly config: CueConfig,
    records: SkillRecord[],
  ) {
    const muted = new Set(config.mute);
    for (const record of records) {
      if (muted.has(record.name)) continue;
      this.gateable.set(record.name, record);
      this.byResolvedPath.set(resolve(record.path), record.name);
    }
  }

  /** Mark a skill satisfied by name, e.g. after a /skill:<name> invocation. */
  markSatisfied(name: string): void {
    this.satisfied.add(name);
  }

  /**
   * Observe a read tool call. Paths are resolved on both sides so a relative path satisfies the
   * gate. Only the SKILL.md itself counts: reading a skill's reference file is not reading the skill.
   */
  noteRead(path: string): void {
    const name = this.byResolvedPath.get(resolve(path));
    if (name) this.satisfied.add(name);
  }

  /**
   * Skills that no longer need injecting or gating this session, whether satisfied by a read or by
   * an explicit /skill: invocation. The injector uses this to avoid repeating itself.
   */
  satisfiedSkills(): Set<string> {
    return new Set(this.satisfied);
  }

  /**
   * Decide whether a tool call is blocked. Returns undefined to allow.
   * When several gates guard the same tool, the first one in config order wins.
   */
  check(tool: string): BlockDecision | undefined {
    if (!this.config.enabled) return undefined;

    for (const [name, gate] of Object.entries(this.config.gates)) {
      if (!gate.tools.includes(tool)) continue;
      const record = this.gateable.get(name);
      if (!record || this.satisfied.has(name)) continue;

      const key = gateKey(name, tool);
      const blocks = this.blocksByGateTool.get(key) ?? 0;
      if (blocks >= RELEASE_AFTER) {
        // Give up permanently rather than resetting the counter, which would re-arm the trap.
        this.satisfied.add(name);
        continue;
      }
      this.blocksByGateTool.set(key, blocks + 1);

      return {
        block: true,
        skill: name,
        reason: `Gated by pi-skill-cue: read the \`${name}\` skill at ${record.path} before using ${tool}. Run /cue off to disable gating for this session.`,
      };
    }

    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gatekeeper.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/gatekeeper.ts tests/gatekeeper.test.ts
git commit -m "feat: add gatekeeper with read detection and anti-deadlock release"
```

---

### Task 9: Ledger

**Files:**
- Create: `src/ledger.ts`
- Test: `tests/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "cue-ledger-"));
}

describe("Ledger", () => {
  it("round-trips appended events", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "inject", ts: 1, session: "s1", skill: "alpha", score: 0.8, reason: "trigger" });
    ledger.append({ type: "read", ts: 2, session: "s1", skill: "alpha" });
    const events = ledger.read();
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("inject");
  });

  it("aggregates per-skill stats", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "inject", ts: 1, session: "s1", skill: "alpha", score: 0.8, reason: "t" });
    ledger.append({ type: "inject", ts: 2, session: "s1", skill: "alpha", score: 0.7, reason: "t" });
    ledger.append({ type: "read", ts: 3, session: "s1", skill: "alpha" });
    ledger.append({ type: "block", ts: 4, session: "s1", skill: "beta", tool: "write" });
    const stats = ledger.stats();
    expect(stats.get("alpha")).toEqual({ injections: 2, reads: 1, blocks: 0 });
    expect(stats.get("beta")).toEqual({ injections: 0, reads: 0, blocks: 1 });
  });

  it("skips malformed lines instead of throwing", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    appendFileSync(ledger.file, "{ not json\n", "utf8");
    expect(ledger.read()).toHaveLength(1);
  });

  it("drops a line missing the field its aggregator reads", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    appendFileSync(ledger.file, `${JSON.stringify({ type: "read", ts: 2 })}\n`, "utf8");
    expect(ledger.read()).toHaveLength(1);
    expect([...ledger.stats().keys()]).toEqual(["alpha"]);
  });

  it("drops a line whose type is not a known event", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    appendFileSync(ledger.file, `${JSON.stringify({ type: "nonsense", skill: "alpha" })}\n`, "utf8");
    expect(ledger.read()).toHaveLength(1);
  });

  it("purges the log file", () => {
    const ledger = new Ledger(dir());
    ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" });
    expect(existsSync(ledger.file)).toBe(true);
    ledger.purge();
    expect(existsSync(ledger.file)).toBe(false);
    expect(ledger.read()).toEqual([]);
  });

  it("swallows write failures so routing is never interrupted", () => {
    const blocker = join(dir(), "not-a-directory");
    writeFileSync(blocker, "");
    const ledger = new Ledger(blocker);
    expect(() => ledger.append({ type: "read", ts: 1, session: "s1", skill: "alpha" })).not.toThrow();
    expect(ledger.read()).toEqual([]);
  });

  it("returns an empty list when the log does not exist yet", () => {
    expect(new Ledger(dir()).read()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ledger.test.ts`
Expected: FAIL — cannot find module `../src/ledger.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEvent, SkillStats } from "./types.js";

/** On-disk name of the active log. Named here so purge and any tooling agree on one contract. */
export const LEDGER_FILENAME = "events.jsonl";
/** Name of the single retained previous log. */
export const LEDGER_PREVIOUS_FILENAME = "events.1.jsonl";
/**
 * Rotate once the active log passes this size. A matched prompt writes up to three lines, so a
 * daily driver would otherwise grow this file forever and every report would re-read all of it.
 */
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;

const KNOWN_TYPES = new Set<LedgerEvent["type"]>(["inject", "read", "block", "error"]);

/**
 * A line is only an event if it carries a known type and the field its aggregator reads. A
 * half-written or hand-edited line would otherwise reach stats() and appear there as a skill
 * literally named "undefined".
 */
function isEvent(value: unknown): value is LedgerEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as { type?: unknown; skill?: unknown; where?: unknown };
  if (!KNOWN_TYPES.has(event.type as LedgerEvent["type"])) return false;
  return event.type === "error" ? typeof event.where === "string" : typeof event.skill === "string";
}

/** Append-only local event log. Every method swallows its own errors: telemetry never breaks routing. */
export class Ledger {
  readonly file: string;
  private readonly previousFile: string;
  private dirReady = false;

  constructor(private readonly dir: string) {
    this.file = join(dir, LEDGER_FILENAME);
    this.previousFile = join(dir, LEDGER_PREVIOUS_FILENAME);
  }

  append(event: LedgerEvent): void {
    try {
      if (!this.dirReady) {
        mkdirSync(this.dir, { recursive: true });
        this.dirReady = true;
      }
      this.rotateIfLarge();
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // Intentionally ignored.
    }
  }

  /** Reads the active log only, so reports describe recent activity rather than all history. */
  read(): LedgerEvent[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }

    const events: LedgerEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isEvent(parsed)) events.push(parsed);
      } catch {
        continue;
      }
    }
    return events;
  }

  stats(): Map<string, SkillStats> {
    const stats = new Map<string, SkillStats>();
    const statsFor = (skill: string): SkillStats => {
      let entry = stats.get(skill);
      if (!entry) {
        entry = { injections: 0, reads: 0, blocks: 0 };
        stats.set(skill, entry);
      }
      return entry;
    };

    for (const event of this.read()) {
      if (event.type === "error") continue;
      const entry = statsFor(event.skill);
      if (event.type === "inject") entry.injections += 1;
      else if (event.type === "read") entry.reads += 1;
      else if (event.type === "block") entry.blocks += 1;
    }
    return stats;
  }

  /** Removes both the active log and the retained previous one. */
  purge(): void {
    try {
      rmSync(this.file, { force: true });
      rmSync(this.previousFile, { force: true });
    } catch {
      // Intentionally ignored.
    }
  }

  private rotateIfLarge(): void {
    try {
      if (statSync(this.file).size < MAX_LEDGER_BYTES) return;
      renameSync(this.file, this.previousFile);
    } catch {
      // No active log yet, or the rename failed; either way appending is still correct.
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ledger.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ledger.ts tests/ledger.test.ts
git commit -m "feat: add local append-only ledger with failure-swallowing writes"
```

---

### Task 10: Doctor lint rules

**Files:**
- Create: `src/doctor.ts`
- Test: `tests/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { deriveRoutingFields } from "../src/catalog.js";
import { lintCatalog } from "../src/doctor.js";
import type { SkillRecord, SkillStats } from "../src/types.js";

function rec(name: string, description: string): SkillRecord {
  return {
    name,
    path: `/fixtures/${name}/SKILL.md`,
    description,
    mtimeMs: 1,
    ...deriveRoutingFields(name, description),
  };
}

const noStats = new Map<string, SkillStats>();

describe("lintCatalog", () => {
  it("flags a description that is too short to route on", () => {
    const findings = lintCatalog([rec("alpha", "Does stuff.")], noStats);
    expect(findings[0]?.codes).toContain("description-too-short");
  });

  it("flags a missing trigger clause", () => {
    const findings = lintCatalog([rec("beta", "A long and detailed explanation of what this skill contains for readers.")], noStats);
    expect(findings[0]?.codes).toContain("no-trigger-clause");
  });

  it("flags two skills whose descriptions are near-identical", () => {
    const findings = lintCatalog(
      [
        rec("gamma", "Use when reviewing pull requests and leaving review comments on them"),
        rec("delta", "Use when reviewing pull requests and leaving review comments on them"),
      ],
      noStats,
    );
    expect(findings.some((f) => f.codes.includes("overlapping-description"))).toBe(true);
  });

  it("flags a skill injected repeatedly but never read", () => {
    const stats = new Map<string, SkillStats>([["epsilon", { injections: 6, reads: 0, blocks: 0 }]]);
    const findings = lintCatalog([rec("epsilon", "Use when handling a specific documented situation arises")], stats);
    expect(findings[0]?.codes).toContain("never-read");
  });

  it("flags a skill whose name shares no terms with its description", () => {
    const findings = lintCatalog([rec("zebra", "Use when performing quarterly ledger reconciliation duties")], noStats);
    expect(findings[0]?.codes).toContain("name-description-disjoint");
  });

  it("returns no findings for a well-formed, exercised skill", () => {
    const stats = new Map<string, SkillStats>([["debugging-helper", { injections: 4, reads: 3, blocks: 0 }]]);
    const findings = lintCatalog(
      [rec("debugging-helper", "Use when debugging a failing test, an exception, or unexpected helper output")],
      stats,
    );
    expect(findings).toEqual([]);
  });

  it("does not call two skills overlapping merely because both say 'use when'", () => {
    const findings = lintCatalog(
      [
        rec("invoice-parsing", "Use when extracting fields from an invoice document or receipt"),
        rec("release-checklist", "Use when cutting a release, tagging a version, or writing notes"),
      ],
      noStats,
    );
    expect(findings.some((f) => f.codes.includes("overlapping-description"))).toBe(false);
  });

  it("reports a finding for each skill in an overlapping pair", () => {
    const findings = lintCatalog(
      [
        rec("alpha-review", "Use when reviewing a pull request and leaving comments on the diff"),
        rec("beta-review", "Use when reviewing a pull request and leaving comments on the diff"),
      ],
      noStats,
    );
    expect(findings.map((f) => f.skill).sort()).toEqual(["alpha-review", "beta-review"]);
  });

  it("does not flag a skill that has been read at least once", () => {
    const stats = new Map<string, SkillStats>([["epsilon", { injections: 9, reads: 1, blocks: 0 }]]);
    const findings = lintCatalog([rec("epsilon", "Use when handling a documented epsilon situation")], stats);
    expect(findings.some((f) => f.codes.includes("never-read"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/doctor.test.ts`
Expected: FAIL — cannot find module `../src/doctor.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { tokenize } from "./text.js";
import type { SkillRecord, SkillStats } from "./types.js";

export type LintCode =
  | "description-too-short"
  | "no-trigger-clause"
  | "overlapping-description"
  | "never-read"
  | "name-description-disjoint";

export interface LintFinding {
  skill: string;
  path: string;
  codes: LintCode[];
  suggestion: string;
}

const MIN_DESCRIPTION_LENGTH = 40;
const NEVER_READ_INJECTIONS = 5;
const OVERLAP_THRESHOLD = 0.85;

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const term of setA) if (setB.has(term)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/**
 * Description terms only, via the router's own tokenizer so filler words cannot inflate
 * similarity. Deliberately not `record.terms`, which folds in the skill name: two skills with the
 * same description and different names genuinely overlap, and that is what this rule must catch.
 */
function descriptionTerms(record: SkillRecord): string[] {
  return tokenize(record.description);
}

function suggestionFor(record: SkillRecord, codes: LintCode[]): string {
  if (codes.includes("description-too-short") || codes.includes("no-trigger-clause")) {
    return `Rewrite as: "Use when <situation>, <situation>, or <situation>." naming the words a user would actually type when they need ${record.name}.`;
  }
  if (codes.includes("overlapping-description")) {
    return "Differentiate the trigger clauses so the two skills cannot both match the same request.";
  }
  if (codes.includes("never-read")) {
    return "The router surfaces this skill but the model declines to read it. Sharpen the trigger clause, or add a gate if it is mandatory.";
  }
  return "Include the words from the skill name in the description so both match paths agree.";
}

/** Lint a catalogue for routability problems. Pure given stats. */
export function lintCatalog(
  records: SkillRecord[],
  stats: Map<string, SkillStats>,
): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const record of records) {
    const codes: LintCode[] = [];

    if (record.description.trim().length < MIN_DESCRIPTION_LENGTH) codes.push("description-too-short");
    if (record.triggerPhrases.length === 0) codes.push("no-trigger-clause");

    // All-pairs comparison. Catalogues are tens of skills, so O(n^2) is not worth avoiding here.
    for (const other of records) {
      if (other.name === record.name) continue;
      if (jaccard(descriptionTerms(record), descriptionTerms(other)) >= OVERLAP_THRESHOLD) {
        codes.push("overlapping-description");
        break;
      }
    }

    const stat = stats.get(record.name);
    if (stat && stat.injections >= NEVER_READ_INJECTIONS && stat.reads === 0) codes.push("never-read");

    const nameTerms = tokenize(record.name);
    const descTerms = new Set(descriptionTerms(record));
    if (nameTerms.length > 0 && !nameTerms.some((term) => descTerms.has(term))) {
      codes.push("name-description-disjoint");
    }

    if (codes.length > 0) {
      findings.push({
        skill: record.name,
        path: record.path,
        codes: [...new Set(codes)],
        suggestion: suggestionFor(record, codes),
      });
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/doctor.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/doctor.ts tests/doctor.test.ts
git commit -m "feat: add skill-doctor lint rules for unroutable skills"
```

---

### Task 11: Report rendering

**Files:**
- Create: `src/report.ts`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { deriveRoutingFields } from "../src/catalog.js";
import { renderDoctor, renderReport } from "../src/report.js";
import type { SkillRecord, SkillStats } from "../src/types.js";

const records: SkillRecord[] = [
  { name: "alpha", path: "/fixtures/alpha/SKILL.md", description: "Use when doing alpha work here", mtimeMs: 1, ...deriveRoutingFields("alpha", "Use when doing alpha work here") },
  { name: "beta", path: "/fixtures/beta/SKILL.md", description: "Use when doing beta work here", mtimeMs: 1, ...deriveRoutingFields("beta", "Use when doing beta work here") },
];

describe("renderReport", () => {
  it("lists every installed skill with its counts", () => {
    const stats = new Map<string, SkillStats>([["alpha", { injections: 3, reads: 2, blocks: 1 }]]);
    const text = renderReport(records, stats);
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).toMatch(/alpha\s+\|\s+3\s+\|\s+2\s+\|\s+1/);
  });

  it("summarises how many skills have never fired", () => {
    const text = renderReport(records, new Map([["alpha", { injections: 1, reads: 1, blocks: 0 }]]));
    expect(text).toContain("1 of 2 skills have never fired");
  });

  it("handles an empty catalogue without throwing", () => {
    expect(renderReport([], new Map())).toContain("No skills loaded");
  });

  it("widens a column instead of breaking alignment on a large count", () => {
    const stats = new Map<string, SkillStats>([["alpha", { injections: 1234567, reads: 89, blocks: 0 }]]);
    const lines = renderReport(records, stats).split("\n");
    const header = lines[0] ?? "";
    const alphaRow = lines.find((line) => line.startsWith("alpha")) ?? "";
    expect(alphaRow).toContain("1234567");
    // Every row's column separators line up with the header's.
    const separatorPositions = (line: string) => [...line].flatMap((ch, i) => (ch === "|" ? [i] : []));
    expect(separatorPositions(alphaRow)).toEqual(separatorPositions(header));
  });
});

describe("renderDoctor", () => {
  it("reports a clean bill of health", () => {
    expect(renderDoctor([])).toContain("No routability problems found");
  });

  it("lists findings with codes and a suggestion", () => {
    const text = renderDoctor([
      { skill: "alpha", path: "/fixtures/alpha/SKILL.md", codes: ["no-trigger-clause"], suggestion: "Rewrite it." },
    ]);
    expect(text).toContain("alpha");
    expect(text).toContain("no-trigger-clause");
    expect(text).toContain("Rewrite it.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/report.test.ts`
Expected: FAIL — cannot find module `../src/report.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { LintFinding } from "./doctor.js";
import type { SkillRecord, SkillStats } from "./types.js";

const EMPTY: SkillStats = { injections: 0, reads: 0, blocks: 0 };

const COLUMNS = { skill: "skill", injected: "injected", read: "read", blocked: "blocked" } as const;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/** Per-skill activity table plus a dead-weight summary. */
export function renderReport(records: SkillRecord[], stats: Map<string, SkillStats>): string {
  if (records.length === 0) return "No skills loaded, so there is nothing to report.";

  const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name));
  const rows = sorted.map((record) => {
    const stat = stats.get(record.name) ?? EMPTY;
    return {
      name: record.name,
      injections: String(stat.injections),
      reads: String(stat.reads),
      blocks: String(stat.blocks),
      neverFired: stat.injections === 0 && stat.reads === 0,
    };
  });

  // Widths come from the header label and the widest value, so a large count widens its column
  // instead of breaking the alignment.
  const widthOf = (label: string, values: string[]): number =>
    Math.max(label.length, ...values.map((value) => value.length));
  const nameWidth = widthOf(COLUMNS.skill, rows.map((row) => row.name));
  const injectedWidth = widthOf(COLUMNS.injected, rows.map((row) => row.injections));
  const readWidth = widthOf(COLUMNS.read, rows.map((row) => row.reads));

  const lines = [
    `${pad(COLUMNS.skill, nameWidth)} | ${pad(COLUMNS.injected, injectedWidth)} | ${pad(COLUMNS.read, readWidth)} | ${COLUMNS.blocked}`,
    `${"-".repeat(nameWidth)}-+-${"-".repeat(injectedWidth)}-+-${"-".repeat(readWidth)}-+-${"-".repeat(COLUMNS.blocked.length)}`,
  ];

  for (const row of rows) {
    lines.push(
      `${pad(row.name, nameWidth)} | ${pad(row.injections, injectedWidth)} | ${pad(row.reads, readWidth)} | ${row.blocks}`,
    );
  }

  const neverFired = rows.filter((row) => row.neverFired).length;
  lines.push("", `${neverFired} of ${records.length} skills have never fired.`);
  return lines.join("\n");
}

export function renderDoctor(findings: LintFinding[]): string {
  if (findings.length === 0) return "No routability problems found.";

  const lines = [`${findings.length} skill(s) need attention:`, ""];
  for (const finding of findings) {
    lines.push(`${finding.skill} — ${finding.codes.join(", ")}`);
    lines.push(`  ${finding.path}`);
    lines.push(`  ${finding.suggestion}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/report.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: add report and doctor text rendering"
```

---

### Task 12: Extension wiring

The only file that touches pi's API. Every handler is wrapped so a thrown error degrades to vanilla pi behaviour.

**Files:**
- Create: `src/runtime.ts`
- Create: `extensions/skill-cue.ts`
- Test: `tests/runtime.test.ts`

`src/runtime.ts` holds the testable decision logic; `extensions/skill-cue.ts` is thin glue that registers hooks and commands. This split exists so the routing decisions can be tested without constructing pi's full extension API.

- [ ] **Step 1: Write the failing test**

```ts
// tests/runtime.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CueRuntime } from "../src/runtime.js";
import { DEFAULT_CONFIG, type CueConfig } from "../src/types.js";

function skill(name: string, description: string): { name: string; path: string; description: string } {
  const root = mkdtempSync(join(tmpdir(), "cue-runtime-"));
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n`);
  return { name, path, description };
}

function runtime(config: CueConfig = DEFAULT_CONFIG) {
  const ledgerDir = mkdtempSync(join(tmpdir(), "cue-runtime-ledger-"));
  return new CueRuntime({ config, ledgerDir, sessionId: "s1" });
}

describe("CueRuntime.onPrompt", () => {
  it("returns a directive naming the matched skill", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const result = runtime().onPrompt("implementing a new feature for the parser", [tdd], []);
    expect(result?.directive).toContain("test-driven-development");
  });

  it("returns undefined when nothing matches", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    expect(runtime().onPrompt("what is the weather", [tdd], [])).toBeUndefined();
  });

  it("returns undefined when disabled", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime({ ...DEFAULT_CONFIG, enabled: false });
    expect(rt.onPrompt("implementing any feature", [tdd], [])).toBeUndefined();
  });

  it("does not inject the same skill twice in a session", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime();
    expect(rt.onPrompt("implementing any feature", [tdd], [])).toBeDefined();
    rt.onToolCall("read", { path: tdd.path });
    expect(rt.onPrompt("implementing any feature", [tdd], [])).toBeUndefined();
  });

  it("survives a malformed skill list without throwing", () => {
    expect(() => runtime().onPrompt("anything", [{ name: "x", path: "/nope/SKILL.md" }], [])).not.toThrow();
  });
});

describe("CueRuntime.onToolCall", () => {
  it("blocks a guarded tool until the gate is satisfied", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime({ ...DEFAULT_CONFIG, gates: { "test-driven-development": { tools: ["write"] } } });
    rt.onPrompt("implementing any feature", [tdd], []);
    expect(rt.onToolCall("write", { path: "/tmp/out.ts" })?.block).toBe(true);
    rt.onToolCall("read", { path: tdd.path });
    expect(rt.onToolCall("write", { path: "/tmp/out.ts" })).toBeUndefined();
  });

  it("never blocks before the catalogue is known", () => {
    const rt = runtime({ ...DEFAULT_CONFIG, gates: { "test-driven-development": { tools: ["write"] } } });
    expect(rt.onToolCall("write", { path: "/tmp/out.ts" })).toBeUndefined();
  });
});

describe("CueRuntime reporting", () => {
  it("records injections in the ledger and surfaces them in the report", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime();
    rt.onPrompt("implementing any feature", [tdd], []);
    expect(rt.report()).toContain("test-driven-development");
  });

  it("purges the ledger on request", () => {
    const tdd = skill("test-driven-development", "Use when implementing any feature or bugfix");
    const rt = runtime();
    rt.onPrompt("implementing any feature", [tdd], []);
    rt.purge();
    expect(rt.report()).toContain("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runtime.test.ts`
Expected: FAIL — cannot find module `../src/runtime.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime.ts
import { buildCatalog, type SkillInput } from "./catalog.js";
import { lintCatalog } from "./doctor.js";
import { Gatekeeper, type BlockDecision } from "./gatekeeper.js";
import { buildDirective } from "./injector.js";
import { Ledger } from "./ledger.js";
import { renderDoctor, renderReport } from "./report.js";
import { scoreSkills } from "./scorer.js";
import type { CueConfig, SkillRecord } from "./types.js";

export interface RuntimeOptions {
  config: CueConfig;
  ledgerDir: string;
  sessionId: string;
}

export interface PromptResult {
  directive: string;
  matched: string[];
}

/**
 * Session-scoped orchestration. Holds no pi types, so it is testable with plain objects.
 * Callers are responsible for catching nothing: every method here is already defensive.
 */
export class CueRuntime {
  private readonly ledger: Ledger;
  private records: SkillRecord[] = [];
  private gatekeeper: Gatekeeper | undefined;
  private enabled: boolean;
  private lastMatch: string | undefined;

  constructor(private readonly options: RuntimeOptions) {
    this.ledger = new Ledger(options.ledgerDir);
    this.enabled = options.config.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  lastMatchSummary(): string {
    return this.lastMatch ?? "no match yet this session";
  }

  /** Called on each user prompt. Returns the directive to append, or undefined to leave the turn untouched. */
  onPrompt(prompt: string, skills: SkillInput[], cwdExtensions: string[]): PromptResult | undefined {
    try {
      if (!this.enabled) return undefined;

      this.records = buildCatalog(skills);
      if (!this.gatekeeper) this.gatekeeper = new Gatekeeper(this.options.config, this.records);
      if (this.records.length === 0) return undefined;

      const matches = scoreSkills(this.records, { prompt, cwdExtensions }, this.options.config);
      const directive = buildDirective(matches, this.gatekeeper.satisfiedSkills());
      if (!directive) return undefined;

      for (const match of matches) {
        this.ledger.append({
          type: "inject",
          ts: Date.now(),
          session: this.options.sessionId,
          skill: match.skill.name,
          score: match.score,
          reason: match.reasons[0]?.detail ?? "",
        });
      }

      this.lastMatch = matches
        .map((m) => `${m.skill.name} (${m.score.toFixed(2)}, ${m.reasons[0]?.kind ?? "terms"})`)
        .join("; ");

      return { directive, matched: matches.map((m) => m.skill.name) };
    } catch (error) {
      this.noteError("onPrompt", error);
      return undefined;
    }
  }

  /** Called before a tool executes. Returns a block decision, or undefined to allow. */
  onToolCall(tool: string, input: { path?: string }): BlockDecision | undefined {
    try {
      if (!this.enabled || !this.gatekeeper) return undefined;

      if (tool === "read" && typeof input.path === "string") {
        const before = this.gatekeeper.satisfiedSkills();
        this.gatekeeper.noteRead(input.path);
        for (const name of this.gatekeeper.satisfiedSkills()) {
          if (before.has(name)) continue;
          this.ledger.append({ type: "read", ts: Date.now(), session: this.options.sessionId, skill: name });
        }
        return undefined;
      }

      const decision = this.gatekeeper.check(tool);
      if (decision) {
        this.ledger.append({
          type: "block",
          ts: Date.now(),
          session: this.options.sessionId,
          skill: decision.skill,
          tool,
        });
      }
      return decision;
    } catch (error) {
      this.noteError("onToolCall", error);
      return undefined;
    }
  }

  /** Satisfy a gate from a /skill:<name> invocation. */
  markSkillUsed(name: string): void {
    try {
      this.gatekeeper?.markSatisfied(name);
    } catch (error) {
      this.noteError("markSkillUsed", error);
    }
  }

  report(): string {
    try {
      return renderReport(this.records, this.ledger.stats());
    } catch (error) {
      this.noteError("report", error);
      return "Report unavailable.";
    }
  }

  doctor(): string {
    try {
      return renderDoctor(lintCatalog(this.records, this.ledger.stats()));
    } catch (error) {
      this.noteError("doctor", error);
      return "Doctor unavailable.";
    }
  }

  purge(): void {
    this.ledger.purge();
  }

  private noteError(where: string, error: unknown): void {
    this.ledger.append({
      type: "error",
      ts: Date.now(),
      session: this.options.sessionId,
      where,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
```

```ts
// extensions/skill-cue.ts
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Skill,
} from "@earendil-works/pi-coding-agent";
import type { SkillInput } from "../src/catalog.js";
import { loadConfig } from "../src/config.js";
import { CueRuntime } from "../src/runtime.js";

/**
 * Pi's Skill carries the SKILL.md location as `filePath`, and marks skills the model is not meant
 * to invoke on its own. Routing one of those would be arguing with the user's own configuration.
 */
function toSkillInputs(skills: readonly Skill[]): SkillInput[] {
  return skills
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => ({ name: skill.name, path: skill.filePath, description: skill.description }));
}

function cwdExtensions(cwd: string): string[] {
  try {
    const found = new Set<string>();
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = entry.name.split(".").pop();
      if (ext && ext !== entry.name) found.add(ext.toLowerCase());
    }
    return [...found];
  } catch {
    return [];
  }
}

export default function activate(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const home = homedir();
  const config = loadConfig(
    join(home, ".pi", "agent", "skill-cue.json"),
    join(ctx.cwd, ".pi", "skill-cue.json"),
  );

  const runtime = new CueRuntime({
    config,
    ledgerDir: join(home, ".pi", "agent", "skill-cue"),
    sessionId: ctx.sessionManager?.getSessionId?.() ?? "unknown",
  });

  pi.on("before_agent_start", async (event) => {
    try {
      const skills = toSkillInputs(event.systemPromptOptions?.skills ?? []);
      const result = runtime.onPrompt(event.prompt ?? "", skills, cwdExtensions(ctx.cwd));
      if (!result) return undefined;

      if (config.verbose) {
        return {
          systemPrompt: `${event.systemPrompt}\n\n${result.directive}`,
          message: { customType: "skill-cue", content: result.directive, display: true },
        };
      }
      return { systemPrompt: `${event.systemPrompt}\n\n${result.directive}` };
    } catch {
      return undefined;
    }
  });

  pi.on("tool_call", async (event) => {
    try {
      const decision = runtime.onToolCall(event.toolName, event.input as { path?: string });
      return decision ? { block: true as const, reason: decision.reason } : undefined;
    } catch {
      return undefined;
    }
  });

  pi.registerCommand("cue", {
    description: "pi-skill-cue status, or on/off for this session",
    handler: async (args: string, _commandCtx: ExtensionCommandContext) => {
      const arg = args.trim().toLowerCase();
      if (arg === "off" || arg === "on") {
        runtime.setEnabled(arg === "on");
        ctx.ui.notify(`pi-skill-cue ${arg}`, "info");
        return;
      }
      ctx.ui.notify(
        `pi-skill-cue ${runtime.isEnabled() ? "on" : "off"} — last match: ${runtime.lastMatchSummary()}`,
        "info",
      );
    },
  });

  pi.registerCommand("cue-report", {
    description: "Show which skills actually fire; --purge clears the local ledger",
    handler: async (args: string, _commandCtx: ExtensionCommandContext) => {
      if (args.trim() === "--purge") {
        runtime.purge();
        ctx.ui.notify("pi-skill-cue ledger purged", "info");
        return;
      }
      ctx.ui.notify(runtime.report(), "info");
    },
  });

  pi.registerCommand("skill-doctor", {
    description: "Lint installed skills for routability problems",
    handler: async (_args: string, _commandCtx: ExtensionCommandContext) => {
      ctx.ui.notify(runtime.doctor(), "info");
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runtime.test.ts && npx tsc --noEmit`
Expected: PASS, 9 tests, and no type errors.

> `@earendil-works/pi-coding-agent` is installed as a devDependency so these types resolve; it stays
> in `peerDependencies` because pi provides it at runtime. If `tsc` reports that a pi API member does
> not match, correct `extensions/skill-cue.ts` against the installed types — never by loosening
> `src/runtime.ts`, which must stay free of pi types. Verified shapes at the time of writing:
> `Skill` is `{ name, description, filePath, baseDir, sourceInfo, disableModelInvocation }`;
> `BeforeAgentStartEvent` is `{ prompt, images?, systemPrompt, systemPromptOptions }`;
> `BeforeAgentStartEventResult` is `{ message?, systemPrompt? }`; `registerCommand(name, options)`
> takes `handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>`; and
> `ctx.ui.notify(message, type?)` accepts `"info" | "warning" | "error"`.

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts extensions/skill-cue.ts tests/runtime.test.ts
git commit -m "feat: wire routing, gating, and commands into the pi extension"
```

---

### Task 13: Benchmark harness

**Files:**
- Create: `bench/corpus.ts`
- Create: `bench/cases.ts`
- Create: `bench/run.ts`
- Create: `bench/baseline.json`
- Test: `tests/bench.test.ts`

**Realism constraint:** at least four corpus skills MUST describe themselves WITHOUT any
"use when" phrasing (plain imperative descriptions, e.g. "Extracts fields from invoices and
receipts"). Many real skills are written that way, so they yield zero trigger phrases and must be
routed on term overlap alone. A corpus where every skill has a tidy trigger clause measures the
easy case and inflates precision@1. Label at least four cases as expecting one of those skills.

**Authoring constraint:** every skill in `bench/corpus.ts` is invented for this repository. No skill from any machine-local or private skill directory may be copied, quoted, paraphrased, or named. Use generic domains (parsers, invoices, widgets) and `ABC-123`-style keys.

- [ ] **Step 1: Write the failing test**

```ts
// tests/bench.test.ts
import { describe, expect, it } from "vitest";
import { CORPUS } from "../bench/corpus.js";
import { CASES } from "../bench/cases.js";
import { evaluate } from "../bench/run.js";
import baseline from "../bench/baseline.json" with { type: "json" };

describe("benchmark", () => {
  it("has a corpus and labelled cases", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(12);
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it("labels every case against a skill that exists in the corpus", () => {
    const names = new Set(CORPUS.map((s) => s.name));
    for (const testCase of CASES) {
      if (testCase.expected === null) continue;
      expect(names.has(testCase.expected)).toBe(true);
    }
  });

  it("includes negative cases that must match nothing", () => {
    expect(CASES.some((c) => c.expected === null)).toBe(true);
  });

  it("includes paraphrase cases that do not repeat description wording", () => {
    expect(CASES.some((c) => c.paraphrase === true)).toBe(true);
  });

  it("meets the committed baseline", () => {
    const result = evaluate();
    expect(result.precisionAt1).toBeGreaterThanOrEqual(baseline.precisionAt1);
    expect(result.recallAt3).toBeGreaterThanOrEqual(baseline.recallAt3);
    expect(result.falsePositiveRate).toBeLessThanOrEqual(baseline.falsePositiveRate);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bench.test.ts`
Expected: FAIL — cannot find module `../bench/corpus.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// bench/corpus.ts
import { extractTriggerPhrases, tokenize } from "../src/text.js";
import type { SkillRecord } from "../src/types.js";

interface Seed {
  name: string;
  description: string;
}

/**
 * Invented skills, authored for this benchmark. Deliberately includes near-neighbour pairs
 * (invoice-parsing vs invoice-reconciliation) so the scorer is measured on hard cases.
 */
const SEEDS: Seed[] = [
  { name: "failing-test-triage", description: "Use when a test is failing, a suite is red, or behaviour does not match expectations, before changing implementation code" },
  { name: "invoice-parsing", description: "Use when extracting fields from an invoice document, a receipt, or a scanned bill" },
  { name: "invoice-reconciliation", description: "Use when matching invoice totals against ledger entries, or chasing a payment discrepancy" },
  { name: "widget-calibration", description: "Use when calibrating a widget sensor, adjusting tolerance ranges, or resetting a device baseline" },
  { name: "banner-artwork", description: "Use when designing a banner, a social image, or promotional artwork for a campaign" },
  { name: "release-checklist", description: "Use when cutting a release, tagging a version, or preparing release notes for shipping" },
  { name: "schema-migration", description: "Use when altering a database table, adding a column, or writing a migration script" },
  { name: "flaky-test-quarantine", description: "Use when a test passes locally but fails intermittently in continuous integration" },
  { name: "ticket-intake", description: "Use when the user references a tracked work item by key, or asks to triage a reported issue" },
  { name: "api-contract-review", description: "Use when changing a public endpoint, altering a response payload, or versioning an interface" },
  { name: "log-forensics", description: "Use when searching production logs for the cause of an outage, error spike, or timeout" },
  { name: "onboarding-walkthrough", description: "Use when a new contributor needs the local setup path, or asks how to run the project for the first time" },
  { name: "dependency-audit", description: "Use when adding a third party library, bumping a version, or reviewing a vulnerability advisory" },
  { name: "copy-editing", description: "Use when tightening written prose, fixing tone, or rewriting documentation for clarity" },
];

export const CORPUS: SkillRecord[] = SEEDS.map((seed, index) => ({
  name: seed.name,
  path: `/fixtures/${seed.name}/SKILL.md`,
  description: seed.description,
  triggerPhrases: extractTriggerPhrases(seed.description),
  terms: [...new Set(tokenize(`${seed.name} ${seed.description}`))],
  mtimeMs: index + 1,
}));
```

```ts
// bench/cases.ts

export interface BenchCase {
  prompt: string;
  /** Expected top skill, or null when nothing should match. */
  expected: string | null;
  /** True when the prompt deliberately avoids the description's wording. */
  paraphrase?: boolean;
}

export const CASES: BenchCase[] = [
  { prompt: "my test suite is red after the last change", expected: "failing-test-triage" },
  { prompt: "this assertion keeps blowing up and I cannot see why", expected: "failing-test-triage", paraphrase: true },
  { prompt: "pull the line items out of this scanned bill", expected: "invoice-parsing" },
  { prompt: "extract fields from an invoice document", expected: "invoice-parsing" },
  { prompt: "the invoice total does not match our ledger entries", expected: "invoice-reconciliation" },
  { prompt: "chase down a payment discrepancy from last month", expected: "invoice-reconciliation" },
  { prompt: "recalibrate the widget sensor tolerance", expected: "widget-calibration" },
  { prompt: "reset the device baseline before shipping", expected: "widget-calibration", paraphrase: true },
  { prompt: "design a banner for the spring campaign", expected: "banner-artwork" },
  { prompt: "I need promotional artwork for social", expected: "banner-artwork" },
  { prompt: "cut a release and write the release notes", expected: "release-checklist" },
  { prompt: "tag version 2.1 and ship it", expected: "release-checklist", paraphrase: true },
  { prompt: "add a column to the accounts table", expected: "schema-migration" },
  { prompt: "write a migration script for the new field", expected: "schema-migration" },
  { prompt: "this test passes locally but fails in CI at random", expected: "flaky-test-quarantine" },
  { prompt: "intermittent failure only on the build server", expected: "flaky-test-quarantine", paraphrase: true },
  { prompt: "take a look at ABC-1234 and triage it", expected: "ticket-intake" },
  { prompt: "triage this reported issue for me", expected: "ticket-intake" },
  { prompt: "we are changing the response payload of the search endpoint", expected: "api-contract-review" },
  { prompt: "version the public interface before clients break", expected: "api-contract-review", paraphrase: true },
  { prompt: "search production logs for the cause of the outage", expected: "log-forensics" },
  { prompt: "there was an error spike at 3am, find out why", expected: "log-forensics" },
  { prompt: "how do I run this project for the first time", expected: "onboarding-walkthrough" },
  { prompt: "new contributor needs the local setup path", expected: "onboarding-walkthrough" },
  { prompt: "review this vulnerability advisory before we bump the version", expected: "dependency-audit" },
  { prompt: "we are adding a third party library for parsing", expected: "dependency-audit" },
  { prompt: "tighten this prose and fix the tone", expected: "copy-editing" },
  { prompt: "rewrite the documentation for clarity", expected: "copy-editing" },
  { prompt: "what is the capital of France", expected: null },
  { prompt: "hello", expected: null },
  { prompt: "thanks, that worked", expected: null },
  { prompt: "what time is the standup", expected: null },
];
```

```ts
// bench/run.ts
import { scoreSkills } from "../src/scorer.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { CORPUS } from "./corpus.js";
import { CASES } from "./cases.js";

export interface BenchResult {
  precisionAt1: number;
  recallAt3: number;
  falsePositiveRate: number;
  cases: number;
}

const CONFIG = { ...DEFAULT_CONFIG, triggers: { "ticket-intake": ["\\b[A-Z]{2,}-\\d{3,}\\b"] } };

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function evaluate(): BenchResult {
  let positives = 0;
  let top1 = 0;
  let inTop3 = 0;
  let negatives = 0;
  let falsePositives = 0;

  for (const testCase of CASES) {
    const matches = scoreSkills(CORPUS, { prompt: testCase.prompt, cwdExtensions: [] }, CONFIG);
    if (testCase.expected === null) {
      negatives += 1;
      if (matches.length > 0) falsePositives += 1;
      continue;
    }
    positives += 1;
    if (matches[0]?.skill.name === testCase.expected) top1 += 1;
    if (matches.slice(0, 3).some((m) => m.skill.name === testCase.expected)) inTop3 += 1;
  }

  return {
    precisionAt1: round(positives === 0 ? 0 : top1 / positives),
    recallAt3: round(positives === 0 ? 0 : inTop3 / positives),
    falsePositiveRate: round(negatives === 0 ? 0 : falsePositives / negatives),
    cases: CASES.length,
  };
}

const isMain = process.argv[1]?.endsWith("run.ts") ?? false;
if (isMain) {
  const result = evaluate();
  console.log(`cases:             ${result.cases}`);
  console.log(`precision@1:       ${result.precisionAt1}`);
  console.log(`recall@3:          ${result.recallAt3}`);
  console.log(`falsePositiveRate: ${result.falsePositiveRate}`);
}
```

Then generate the baseline from the actual first run rather than guessing it:

```bash
npm run bench
```

Write the observed numbers into `bench/baseline.json`, rounded **down** to two decimals for precision/recall and **up** for the false-positive rate, so the committed baseline is a floor rather than an exact fingerprint:

```json
{
  "precisionAt1": 0.75,
  "recallAt3": 0.85,
  "falsePositiveRate": 0.25
}
```

> If the first run scores below `precisionAt1 0.7` or `recallAt3 0.8`, do not lower the baseline to fit. Tune the weights in `src/scorer.ts` (`WEIGHT_TRIGGER`, `WEIGHT_TERMS`, the partial-phrase rule in `triggerHit`) and re-run until it clears, keeping all Task 6 unit tests green. The benchmark exists to apply this pressure.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bench.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add bench tests/bench.test.ts
git commit -m "test: add routing benchmark with invented corpus and committed baseline"
```

---

### Task 14: Leak guard

**Files:**
- Create: `scripts/check-leaks.mjs`
- Create: `.leakpatterns.example`
- Modify: `.gitignore`
- Test: `tests/leaks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/leaks.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/leaks.test.ts`
Expected: FAIL — cannot find `scripts/check-leaks.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/check-leaks.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const GENERIC = [
  { id: "absolute-home-path", regex: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
  { id: "email-address", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: "credential-shape", regex: /\b(?:sk|pk|ghp|gho|xox[abps])[-_][A-Za-z0-9_-]{20,}\b/ },
  { id: "private-ip", regex: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
  { id: "internal-tld", regex: /\b[a-z0-9-]+\.(?:internal|corp|local|intranet)\b/i },
];

const FORBIDDEN_FILES = [/(^|\/)\.env(\.|$)/, /(^|\/)auth\.json$/, /\.pem$/, /\.p12$/, /_rsa$/];

const SELF = new Set([".leakpatterns.local", ".leakpatterns.example", "scripts/check-leaks.mjs"]);
/** A line containing this marker is skipped. Used for deliberate fixtures and documentation examples. */
const SUPPRESS = "leak-guard-allow";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const BINARY = /\.(png|jpe?g|gif|webp|mp4|zip|gz|ico|woff2?)$/i;

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const root = dirIndex === -1 ? process.cwd() : args[dirIndex + 1];
const strict = args.includes("--strict");

function loadLocalPatterns() {
  try {
    return readFileSync(join(root, ".leakpatterns.local"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((term) => ({ id: `local-pattern:${term.slice(0, 4)}***`, regex: new RegExp(term, "i") }));
  } catch {
    return undefined;
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name))));
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const local = loadLocalPatterns();
if (strict && !local) {
  console.error("check-leaks: strict mode requires .leakpatterns.local to be present; refusing to publish.");
  process.exit(1);
}

const patterns = [...GENERIC, ...(local ?? [])];
const findings = [];

for (const file of await walk(root)) {
  const rel = relative(root, file).split("\\").join("/");
  if (SELF.has(rel)) continue;

  if (FORBIDDEN_FILES.some((r) => r.test(rel))) {
    findings.push(`${rel}: forbidden-file`);
    continue;
  }
  if (BINARY.test(rel) || statSync(file).size > 2_000_000) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // Intentional fixtures (the guard's own tests, plan documents showing example findings)
    // carry this marker. Suppression is per line, so nothing else in the file is excused.
    if (line.includes(SUPPRESS)) return;
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) findings.push(`${rel}:${index + 1}: ${pattern.id}`);
    }
  });
}

if (findings.length > 0) {
  console.error("check-leaks found problems:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`check-leaks: clean (${patterns.length} patterns${local ? ", local set loaded" : ", generic only"})`);
```

```
# .leakpatterns.example
# Copy to .leakpatterns.local (gitignored) and add identity- or employer-specific terms,
# one case-insensitive regex per line. These deliberately do not live in the repository:
# a committed denylist naming internal projects is itself a disclosure.
#
# your-unix-username
# your-employer-name
# your-internal-hostname
# [A-Z]{4,}-\d{3,}
```

Append to `.gitignore` (already contains `.leakpatterns.local` from the spec commit; verify and add if absent):

```
coverage/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/leaks.test.ts && npm run check:leaks`
Expected: PASS, 10 tests, and `check-leaks: clean`.

> The repo-wide `check:leaks` run scans this plan document too. The example finding inside it
> carries the `leak-guard-allow` marker for the same reason the test fixture does: the guard has to
> be demonstrable without tripping itself, and a guard that cannot be demonstrated is not trusted.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-leaks.mjs .leakpatterns.example .gitignore tests/leaks.test.ts
git commit -m "chore: add leak guard with generic patterns and untracked local denylist"
```

---

### Task 15: README, gallery metadata, and CI

**Files:**
- Create: `README.md`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (add `pi.image` once a screenshot exists)

- [ ] **Step 1: Write the failing test**

```ts
// tests/readme.test.ts
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
    expect(readme).toContain(String(result.precisionAt1));
    expect(readme).toContain(String(result.recallAt3));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/readme.test.ts`
Expected: FAIL — `README.md` does not exist.

- [ ] **Step 3: Write minimal implementation**

Write `README.md` with these sections in order:

1. **Title and one-line pitch.** "Your skills only help if the model reads them. `pi-skill-cue` makes sure it does."
2. **The problem**, quoting pi's own skills documentation: *"the agent uses `read` to load the full SKILL.md (models don't always do this; use prompting or `/skill:name` to force it)"*.
3. **Install:** `pi install npm:pi-skill-cue`. State plainly: no API key, no network, no runtime dependencies, no per-turn cost.
4. **How it works** — the three surfaces (route, gate, report) in one short paragraph each.
5. **Benchmark table** with the live numbers from `npm run bench` (precision@1, recall@3, false-positive rate, case count) and a link to `bench/`. Add one line: most routing packages assert accuracy; this one publishes it and fails CI on regression.
6. **Configuration** — the full example from the spec, with invented skill names and `ABC-123`-style keys only.
7. **Commands** — `/cue`, `/cue off`, `/cue on`, `/cue-report`, `/cue-report --purge`, `/skill-doctor`.
8. **Privacy** — the ledger is local, never leaves your machine, `/cue-report --purge` deletes it, and the extension makes no network calls.
9. **Failure behaviour** — fail-open by design; the anti-deadlock rule stated explicitly so gate users know a block cannot trap them.
10. **Contributing** — copy `.leakpatterns.example` to `.leakpatterns.local` before publishing.

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run bench
      - run: npm run check:leaks
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npx tsc --noEmit && npm run check:leaks`
Expected: All suites PASS, no type errors, `check-leaks: clean`.

- [ ] **Step 5: Commit**

```bash
git add README.md .github/workflows/ci.yml tests/readme.test.ts
git commit -m "docs: add README with published benchmark numbers and CI workflow"
```

---

### Task 16: Manual verification in a live pi session

Automated tests cover the units. This task proves the extension works inside a real pi process, which no unit test can establish.

**Files:**
- Create: `docs/manual-verification.md`

- [ ] **Step 1: Load the extension without installing it**

```bash
cd /tmp && mkdir -p cue-trial && cd cue-trial
pi -e /absolute/path/to/pi-skill-cue
```

- [ ] **Step 2: Confirm the router is live**

In the session, run `/cue`.
Expected: a status line reading `pi-skill-cue on — last match: no match yet this session`.

- [ ] **Step 3: Confirm a match is detected**

Send a prompt matching an installed skill's trigger clause, then run `/cue`.
Expected: `last match:` now names that skill with a score and reason kind.

- [ ] **Step 4: Confirm a gate blocks and then releases**

Create `/tmp/cue-trial/.pi/skill-cue.json` naming a skill you have installed:

```json
{ "gates": { "<an-installed-skill-name>": { "tools": ["write"] } } }
```

Restart pi with `-e`, ask it to create a file, and observe the block message naming the skill and its path. Then ask it to read that `SKILL.md` and retry.
Expected: first attempt blocked with the skill named; after the read, the write proceeds.

- [ ] **Step 5: Confirm the anti-deadlock release**

With the same gate active, instruct the model to attempt the write three times without reading the skill.
Expected: attempts one and two are blocked; attempt three proceeds with the gate released.

- [ ] **Step 6: Confirm reporting and purge**

Run `/cue-report`, then `/cue-report --purge`, then `/cue-report` again.
Expected: a per-skill table with a "never fired" summary line; after purge, all counts are zero.

- [ ] **Step 7: Confirm fail-open**

Temporarily point the global config path at a malformed file (`echo '{ broken' > ~/.pi/agent/skill-cue.json`), start a session, and send a prompt.
Expected: the session behaves normally with default settings and no error surfaces. Restore or delete the file afterwards.

- [ ] **Step 8: Record results and commit**

Write `docs/manual-verification.md` with each step, the observed result, and the pi version tested. Use no absolute home paths in the file.

```bash
git add docs/manual-verification.md
git commit -m "docs: record manual verification against a live pi session"
```

---

### Task 17: Publish

- [ ] **Step 1: Copy the local denylist into place**

```bash
cp .leakpatterns.example .leakpatterns.local
```

Edit `.leakpatterns.local` to add your username, employer name, internal hostnames, and internal ticket-key pattern. Confirm it is ignored:

```bash
git check-ignore -v .leakpatterns.local
```

Expected: output naming `.gitignore`. If there is no output, **stop** — the file would be committed.

- [ ] **Step 2: Inspect the tarball by eye**

```bash
npm pack --dry-run
```

Expected: only `extensions/`, `src/`, `README.md`, `LICENSE`, `package.json`. No `tests/`, no `bench/`, no `docs/`, no `.leakpatterns.local`, no `scripts/`.

- [ ] **Step 3: Run the strict guard against the packed contents**

```bash
npm pack
mkdir -p /tmp/cue-verify && tar -xzf pi-skill-cue-0.1.0.tgz -C /tmp/cue-verify
node scripts/check-leaks.mjs --dir /tmp/cue-verify/package --strict
```

Expected: `check-leaks: clean (… local set loaded)`. Any finding blocks the publish.

- [ ] **Step 4: Remove the publish block and add source links**

Task 1 set `"private": true` so an incomplete scaffold could not be published by accident. Remove
it now, and add the three fields a public package needs for its npm and gallery listing:

```json
"repository": { "type": "git", "url": "git+https://github.com/<owner>/pi-skill-cue.git" },
"bugs": { "url": "https://github.com/<owner>/pi-skill-cue/issues" },
"homepage": "https://github.com/<owner>/pi-skill-cue#readme"
```

Replace `<owner>` with the actual GitHub owner. Re-run `npm run typecheck && npm test` after the
edit, then commit.

- [ ] **Step 5: Publish**

```bash
npm publish --access public
```

- [ ] **Step 6: Verify the round trip**

```bash
cd /tmp && mkdir -p cue-installed && cd cue-installed
pi install npm:pi-skill-cue
```

Start pi, run `/cue`, and confirm the status line appears.

- [ ] **Step 7: Tag the release**

```bash
git tag v0.1.0
git push --tags
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Router / `before_agent_start` injection | 6, 7, 12 |
| Scoring signals (trigger, regex, IDF terms, context) | 3, 6 |
| Injection shape and budget | 7 |
| Gates, satisfaction, anti-deadlock | 8, 12, 16 |
| Configuration, per-key merge, validation | 4 |
| Commands (`/cue`, `/cue-report`, `/skill-doctor`) | 11, 12 |
| Doctor lint rules | 10 |
| Ledger, local-only, purge | 9 |
| Failure behaviour, fail-open | 8, 9, 12, 16 |
| Testing: unit, integration, benchmark | 3–13 |
| Leak prevention: corpus, paths, examples, allowlist, guard | 1, 13, 14, 17 |
| Shipping: keywords, README, licence | 1, 15, 17 |

Two spec items are deliberately deferred and not covered by any task: **`escalate` (opt-in LLM routing)** is validated in config (Task 4) and read by nothing, and **`/skill-doctor` model-drafted rewrites** ship as static suggestion text. Both are post-0.1.0. The benchmark in Task 13 must establish whether escalation is needed at all before it is built — building it before measuring would be guessing.

**Placeholder scan:** no TBDs, no "add error handling", no "similar to Task N". Every code step contains complete code. Task 13's baseline values are generated by running the benchmark rather than asserted in advance, with an explicit floor and instructions for what to do if the floor is missed. Task 15's README is specified section by section rather than written out, and its content is enforced by `tests/readme.test.ts`.

**Type consistency:** `SkillRecord`, `RankedMatch`, `MatchReason`, `ScoreSignals`, `CueConfig`, `GateConfig`, `LedgerEvent`, `SkillStats` are defined once in Task 2 and used unchanged thereafter. `SkillInput` is introduced in Task 5 (`src/catalog.ts`) and imported by Task 12. `BlockDecision` is introduced in Task 8 and returned by Task 12. `LintFinding` and `LintCode` are introduced in Task 10 and consumed by Task 11. Method names are stable across tasks: `buildCatalog`, `parseSkillFile`, `clearCatalogCache`, `tokenize`, `extractTriggerPhrases`, `loadConfig`, `mergeConfig`, `scoreSkills`, `buildDirective`, `Gatekeeper.check/noteRead/markSatisfied/readSkills`, `Ledger.append/appendRaw/read/stats/purge`, `lintCatalog`, `renderReport`, `renderDoctor`, `CueRuntime.onPrompt/onToolCall/markSkillUsed/report/doctor/purge/setEnabled/isEnabled/lastMatchSummary`, `evaluate`.

One known risk carried into implementation: Task 12's `extensions/skill-cue.ts` is written against the documented pi API, and the exact shapes of `registerCommand` options, `systemPromptOptions.skills` elements, and `sessionManager.getSessionId` must be confirmed against the installed types. Step 4 of that task runs `tsc --noEmit` specifically to force that reconciliation, and the instruction is explicit that fixes go in the glue file, never by weakening `src/runtime.ts`.
