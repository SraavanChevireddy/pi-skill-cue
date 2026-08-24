import { tokenize } from "./text.js";
import type { CueConfig, MatchReason, RankedMatch, ScoreSignals, SkillRecord } from "./types.js";

const WEIGHT_TRIGGER = 0.55;
const WEIGHT_TERMS = 0.45;
const WEIGHT_CONTEXT = 0.1;
const REGEX_SCORE = 0.96;

/** Inverse document frequency across the catalogue, so catalogue-wide terms contribute ~nothing. */
function buildIdf(records: SkillRecord[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const record of records) {
    for (const term of new Set(record.terms)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  const total = Math.max(records.length, 1);
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log(1 + total / (1 + df)));
  }
  return idf;
}

function termRatio(promptTerms: string[], record: SkillRecord, idf: Map<string, number>): number {
  if (promptTerms.length === 0) return 0;
  const skillTerms = new Set(record.terms);
  let matched = 0;
  let possible = 0;
  for (const term of new Set(promptTerms)) {
    const weight = idf.get(term) ?? Math.log(2);
    possible += weight;
    if (skillTerms.has(term)) matched += weight;
  }
  return possible === 0 ? 0 : matched / possible;
}

function triggerHit(prompt: string, record: SkillRecord): string | undefined {
  const haystack = prompt.toLowerCase();
  for (const phrase of record.triggerPhrases) {
    if (haystack.includes(phrase)) return phrase;
    const words = phrase.split(/\s+/).filter((w) => w.length > 3);
    if (words.length < 2) continue;
    const matched = words.filter((w) => haystack.includes(w)).length;
    if (matched / words.length >= 0.6) return phrase;
  }
  return undefined;
}

function regexHit(prompt: string, name: string, config: CueConfig): string | undefined {
  for (const source of config.triggers[name] ?? []) {
    try {
      if (new RegExp(source, "i").test(prompt)) return source;
    } catch {
      continue;
    }
  }
  return undefined;
}

function contextHit(record: SkillRecord, signals: ScoreSignals): string | undefined {
  const text = `${record.name} ${record.description}`.toLowerCase();
  for (const ext of signals.cwdExtensions) {
    if (ext.length >= 2 && text.includes(ext.toLowerCase())) return ext;
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
  const muted = new Set(config.mute);
  const candidates = records.filter((r) => !muted.has(r.name));
  if (candidates.length === 0) return [];

  const idf = buildIdf(candidates);
  const promptTerms = tokenize(signals.prompt);
  const matches: RankedMatch[] = [];

  for (const skill of candidates) {
    const reasons: MatchReason[] = [];

    const regex = regexHit(signals.prompt, skill.name, config);
    if (regex) reasons.push({ kind: "regex", detail: regex });

    const trigger = triggerHit(signals.prompt, skill);
    if (trigger) reasons.push({ kind: "trigger", detail: trigger });

    const ratio = termRatio(promptTerms, skill, idf);
    if (ratio > 0) reasons.push({ kind: "terms", detail: `term overlap ${ratio.toFixed(2)}` });

    const context = contextHit(skill, signals);
    if (context) reasons.push({ kind: "context", detail: `${context} files in cwd` });

    let score =
      (trigger ? WEIGHT_TRIGGER : 0) + WEIGHT_TERMS * ratio + (context ? WEIGHT_CONTEXT : 0);
    if (regex) score = Math.max(score, REGEX_SCORE);
    score = Math.min(1, score);

    if (score >= config.threshold) matches.push({ skill, score, reasons });
  }

  matches.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return matches.slice(0, config.maxSkills);
}
