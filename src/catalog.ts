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

  const block = FRONTMATTER.exec(raw)?.[1];
  if (!block) return undefined;

  let name = "";
  let description = "";
  for (const line of block.split(/\r?\n/)) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (!match) continue;
    if (match[1] === "name") name = unquote(match[2] ?? "");
    else description = unquote(match[2] ?? "");
  }

  if (!name) return undefined;
  return { name, description };
}

const cache = new Map<string, { mtimeMs: number; record: SkillRecord }>();

/** Exposed for tests that need a cold cache. */
export function clearCatalogCache(): void {
  cache.clear();
}

function makeRecord(input: SkillInput, mtimeMs: number): SkillRecord | undefined {
  const parsed = parseSkillFile(input.path);
  const description = input.description ?? parsed?.description ?? "";
  const name = input.name || parsed?.name || "";
  if (!name || (!description && !parsed)) return undefined;

  return {
    name,
    path: input.path,
    description,
    triggerPhrases: extractTriggerPhrases(description),
    terms: [...new Set(tokenize(`${name} ${description}`))],
    mtimeMs,
  };
}

/** Normalise pi's loaded skills into routing records. mtime-cached; unparseable skills are dropped. */
export function buildCatalog(inputs: SkillInput[]): SkillRecord[] {
  const records: SkillRecord[] = [];

  for (const input of inputs) {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(input.path).mtimeMs;
    } catch {
      continue;
    }

    const key = `${input.path}::${input.description ?? ""}`;
    const cached = cache.get(key);
    if (cached && cached.mtimeMs === mtimeMs) {
      records.push(cached.record);
      continue;
    }

    const record = makeRecord(input, mtimeMs);
    if (!record) continue;
    cache.set(key, { mtimeMs, record });
    records.push(record);
  }

  return records;
}
