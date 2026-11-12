/**
 * Deterministic phrase-level enforcement for workspace strategy exclusions.
 *
 * The prompt also asks providers to avoid related themes. This guard catches
 * literal configured exclusions in source topics and generated output; it is
 * intentionally conservative and does not claim semantic moderation.
 */
export function findExcludedPhrase(
  text: string | null | undefined,
  exclusions: string[] | null | undefined
): string | null {
  if (!text || !Array.isArray(exclusions) || exclusions.length === 0) return null;
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
  for (const raw of exclusions) {
    if (typeof raw !== "string") continue;
    const phrase = raw.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
    if (phrase.length >= 3 && normalizedText.includes(phrase)) return raw;
  }
  return null;
}

export class StrategyExclusionError extends Error {
  constructor(_context: string) {
    super("This topic includes something you’ve chosen to avoid. Change the topic or update your content preferences, then try again.");
    this.name = "StrategyExclusionError";
  }
}

export function assertNoExcludedPhrase(
  text: string | null | undefined,
  exclusions: string[] | null | undefined,
  context: string
): void {
  const matched = findExcludedPhrase(text, exclusions);
  if (matched) {
    throw new StrategyExclusionError(context);
  }
}
