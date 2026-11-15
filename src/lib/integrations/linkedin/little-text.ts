/**
 * LinkedIn "little text" escaping for the Posts API `commentary` field.
 *
 * LinkedIn does not read `commentary` as plain text. It reads it in "little
 * text format", where these characters are markup:
 *
 *   \ | { } @ [ ] ( ) < > # * _ ~
 *
 * A reserved character that is not escaped is treated as the start of markup
 * (a mention, a hashtag template, an emphasis marker, ...). When that markup
 * is incomplete, such as an opening "(" with no matching template, the post
 * can be cut off at that point. Normal writing is full of these characters
 * (parentheses, brackets, underscores, "#1", ...), which is why only some
 * posts were affected.
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
 *
 * Hashtags are kept as real hashtags by writing them in the documented
 * hashtag template, `{hashtag|\#|Tag}`, instead of escaping the "#".
 *
 * Escape ONCE, right before the text goes into the request body. JSON.stringify
 * adds its own escaping for the backslashes, so do not double-escape.
 */

// Group 1: a hashtag ("#" not glued to a word, followed by a tag that has at
// least one letter, so "#1" and "C#" stay plain text). Otherwise: any single
// reserved character.
const LITTLE_TEXT_TOKEN = /(?<![\p{L}\p{N}_])#((?=[\p{N}_]*\p{L})[\p{L}\p{N}_]+)|[\\|{}@[\]()<>#*_~]/gu;

function escapeReserved(value: string): string {
  return value.replace(/[\\|{}@[\]()<>#*_~]/g, "\\$&");
}

export function escapeLinkedInCommentary(text: string): string {
  return text.replace(LITTLE_TEXT_TOKEN, (match, hashtag: string | undefined) =>
    hashtag !== undefined ? `{hashtag|\\#|${escapeReserved(hashtag)}}` : `\\${match}`
  );
}
