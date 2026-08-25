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
