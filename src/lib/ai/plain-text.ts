/**
 * Normalize model output into plain LinkedIn post text.
 * LinkedIn's post composer does not render Markdown. Keep the words and
 * intentional paragraph structure, but remove Markdown presentation syntax.
 */
export function normalizeLinkedInPostText(input: string): string {
  const text = input
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*[\x60]{3}[^\n]*\n?/gm, "")
    .replace(/^\s*[\x60]{3}\s*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/[\x60]([^\x60\n]+)[\x60]/g, "$1")
    .replace(/\*\*(\S[\s\S]*?\S)\*\*/g, "$1")
    .replace(/__(\S[\s\S]*?\S)__/g, "$1")
    .replace(/~~(\S[\s\S]*?\S)~~/g, "$1")
    .replace(/(?<!\*)\*(\S[^*\n]*?\S)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(\S[^_\n]*?\S)_(?!_)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    // Remove orphaned emphasis markers left by malformed model output.
    .replace(/\*{1,3}(?=\s|$)|(?<=\s)\*{1,3}/g, "")
    .replace(/_{1,2}(?=\s|$)|(?<=\s)_{1,2}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
