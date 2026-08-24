import { readFileSync } from "node:fs";
import { createDefaultConfig, type CueConfig, type GateConfig } from "./types.js";

type PartialConfig = Partial<CueConfig>;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function cleanGates(value: unknown): Record<string, GateConfig> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: Record<string, GateConfig> = {};
  for (const [name, gate] of Object.entries(value as Record<string, unknown>)) {
    const tools = (gate as GateConfig | undefined)?.tools;
    if (isStringArray(tools) && tools.length > 0) out[name] = { tools };
  }
  return out;
}

function cleanTriggers(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: Record<string, string[]> = {};
  for (const [name, patterns] of Object.entries(value as Record<string, unknown>)) {
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
  return out;
}

/** Validate one layer, dropping anything malformed. Unknown keys are discarded. */
function sanitize(raw: unknown): PartialConfig {
  if (typeof raw !== "object" || raw === null) return {};
  const input = raw as Record<string, unknown>;
  const out: PartialConfig = {};

  if (typeof input.enabled === "boolean") out.enabled = input.enabled;
  if (typeof input.verbose === "boolean") out.verbose = input.verbose;
  if (typeof input.maxSkills === "number" && input.maxSkills >= 1 && input.maxSkills <= 10) {
    out.maxSkills = Math.floor(input.maxSkills);
  }
  if (typeof input.threshold === "number" && input.threshold > 0 && input.threshold < 1) {
    out.threshold = input.threshold;
  }
  if (isStringArray(input.mute)) out.mute = input.mute;

  const gates = cleanGates(input.gates);
  if (gates) out.gates = gates;

  const triggers = cleanTriggers(input.triggers);
  if (triggers) out.triggers = triggers;

  const escalate = input.escalate as CueConfig["escalate"] | undefined;
  if (escalate && typeof escalate.enabled === "boolean") {
    out.escalate = {
      enabled: escalate.enabled,
      model: typeof escalate.model === "string" ? escalate.model : null,
    };
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
