const STOPWORDS = new Set([
  "the", "this", "that", "these", "those", "and", "for", "with", "when", "use",
  "using", "used", "any", "all", "you", "your", "are", "was", "were", "has",
  "have", "had", "not", "but", "can", "will", "should", "would", "into", "from",
  "before", "after", "then", "than", "them", "they", "its", "our", "out", "get",
  "let", "one", "two", "how", "why", "what", "which", "who", "whom", "code",
  "file", "files", "please", "help", "make", "need", "want", "like", "just",
  "some", "more", "most", "other", "also", "about", "over", "under", "very",
]);

const MIN_TOKEN_LENGTH = 3;
const MIN_PHRASE_LENGTH = 8;

/** Deterministic tokeniser. Lowercase, alphanumeric runs, stopwords and short tokens removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}

const TRIGGER_LEAD = /(?:use|apply|activate|invoke)\s+(?:this\s+)?(?:skill\s+)?when\s+/gi;

/**
 * Extract trigger phrases from a skill description. Skill authors conventionally write
 * "Use when X, Y, or Z"; each comma- or "or"-separated clause becomes a phrase.
 */
export function extractTriggerPhrases(description: string): string[] {
  const phrases: string[] = [];
  const matches = [...description.matchAll(TRIGGER_LEAD)];

  for (const match of matches) {
    const start = (match.index ?? 0) + match[0].length;
    const tail = description.slice(start).split(/(?:\.\s|\.$|;|\n)/)[0] ?? "";
    for (const raw of tail.split(/,\s*(?:or\s+)?|\s+or\s+/i)) {
      const phrase = raw.trim().replace(/[.:;]+$/, "").toLowerCase();
      if (phrase.length >= MIN_PHRASE_LENGTH) phrases.push(phrase);
    }
  }

  return [...new Set(phrases)];
}
