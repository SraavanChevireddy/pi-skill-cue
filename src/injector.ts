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
