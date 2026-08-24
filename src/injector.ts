import type { RankedMatch } from "./types.js";

export const MAX_DIRECTIVE_CHARS = 600;

const HEADER = "## Skill match for this request";
const FOOTER =
  "Read the matching SKILL.md before acting. If a match is irrelevant to what was asked, ignore it and continue.";

function line(match: RankedMatch): string {
  const reason = match.reasons[0]?.detail ?? "lexical match";
  const trimmed = reason.length > 80 ? `${reason.slice(0, 77)}...` : reason;
  return `- \`${match.skill.name}\` (${match.skill.path}) — matched: ${trimmed}`;
}

/**
 * Render ranked matches into a directive appended to the turn's system prompt.
 * Skills already read this session are omitted: repeating them trains the model to ignore the block.
 */
export function buildDirective(matches: RankedMatch[], alreadyRead: Set<string>): string | undefined {
  const fresh = matches.filter((m) => !alreadyRead.has(m.skill.name));
  if (fresh.length === 0) return undefined;

  const lines: string[] = [];
  let length = HEADER.length + FOOTER.length + 2;

  for (const match of fresh) {
    const rendered = line(match);
    if (length + rendered.length + 1 > MAX_DIRECTIVE_CHARS) break;
    lines.push(rendered);
    length += rendered.length + 1;
  }

  if (lines.length === 0) return undefined;
  return [HEADER, ...lines, FOOTER].join("\n");
}
