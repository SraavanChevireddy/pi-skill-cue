import { tokenize } from "./text.js";
import type { CueConfig, MatchReason, RankedMatch, ScoreSignals, SkillRecord } from "./types.js";

/** Weight of a matched "use when" phrase from the skill's own description. */
const WEIGHT_TRIGGER = 0.6;
/** Weight of IDF-weighted term overlap between the prompt and the skill. */
const WEIGHT_TERMS = 0.6;
/** Bonus when a working-directory signal agrees. Deliberately small: it is weak evidence. */
const WEIGHT_CONTEXT = 0.1;
/** A user-configured regex is a declaration of certainty, so it outranks anything inferred. */
const REGEX_SCORE = 1;
/** A phrase counts as matched when this fraction of its significant words appear in the prompt. */
const PARTIAL_PHRASE_RATIO = 0.5;
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
