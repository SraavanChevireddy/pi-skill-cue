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
    triggerPhrases: extractTriggerPhrases(description),
    terms: [...new Set(tokenize(`${name} ${description}`))],
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
