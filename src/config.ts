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
