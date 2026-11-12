import type { VoiceProfileContext } from "./types";

export class VoiceConstraintError extends Error {
  readonly code = "VOICE_CONSTRAINT_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "VoiceConstraintError";
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function isWordCharacter(value: string): boolean {
  return /[\p{L}\p{N}_]/u.test(value);
}

function containsPhrase(text: string, phrase: string): boolean {
  let index = text.indexOf(phrase);
  while (index !== -1) {
    const end = index + phrase.length;
    const hasLeftBoundary = index === 0 || !isWordCharacter(text[index - 1]);
    const hasRightBoundary = end === text.length || !isWordCharacter(text[end]);
    if (hasLeftBoundary && hasRightBoundary) return true;
    index = text.indexOf(phrase, index + 1);
  }
  return false;
}

export function findVoiceConstraintConflict(
  text: string,
  voiceProfile?: VoiceProfileContext | null
): string | null {
  if (!voiceProfile) return null;
  const candidate = normalize(text);
  const forbidden = [
    ...(voiceProfile.phrasesAvoid ?? []),
    ...(voiceProfile.exclusions ?? []),
  ].map(normalize).filter(Boolean);
  return forbidden.find((phrase) => containsPhrase(candidate, phrase)) ?? null;
}

export function assertVoiceConstraints(
  text: string,
  voiceProfile?: VoiceProfileContext | null
): void {
  const conflict = findVoiceConstraintConflict(text, voiceProfile);
  if (conflict) {
    throw new VoiceConstraintError(
      "This content includes a phrase or topic you’ve asked Nunuza to avoid. Update the content or your writing preferences, then try again."
    );
  }
}
