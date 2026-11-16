/**
 * Decides what a plain Telegram message means before anything is generated.
 *
 * Every non-command message used to become a draft, so "hello", "what can you
 * do?" or "thanks" burned a draft and produced a post about nothing. A draft is
 * now created only when the message is clearly a content request, or confirmed
 * with a button when it is too vague to tell. Pure and synchronous on purpose:
 * no AI call, no cost, no latency, and the behaviour is testable.
 */

export type TelegramIntent =
  /** Greeting, thanks, acknowledgement or small talk. Reply, never draft. */
  | "chitchat"
  /** A question about Nunuza, the draft or the account. Reply, never draft. */
  | "question"
  /** A clear request to write a (new) post. */
  | "create"
  /** An edit request for the draft being discussed. */
  | "revise"
  /** Could be a topic, could be chat. Ask with buttons before drafting. */
  | "vague";

const CHITCHAT =
  /^(?:hi+|hello+|hey+|hola|yo|sup|good\s+(?:morning|afternoon|evening|night)|thanks?(?:\s+you)?|thank\s+you(?:\s+so\s+much)?|thx|ty|ok(?:ay)?|k|great|nice|cool|awesome|perfect|good|got\s+it|alright|sure|yes|yeah|yep|no|nope|lol|haha+|wow|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|are\s+you\s+(?:there|working|real|a\s+bot)|test(?:ing)?|ping|bye|goodbye|see\s+you)\b(?:\s+(?:there|nunuza|bot|team|everyone|again|man|buddy))?[\s\p{P}\p{S}]*$/iu;

const CREATE_VERB_OBJECT =
  /\b(?:write|draft|create|generate|compose|make|prepare|give\s+me)\b.{0,50}\b(?:post|linkedin|article|carousel|update|announcement)\b/;
const CREATE_PHRASE =
  /\b(?:new\s+post|another\s+post|different\s+topic|post\s+about|write\s+about|start\s+a\s+new\s+post|start\s+over|a\s+post\s+(?:on|about))\b/;

const REVISE =
  /\b(?:make\s+it|shorten|shorter|longer|lengthen|rewrite|re-?write|rephrase|reword|change|edit|tweak|adjust|update|fix|improve|polish|trim|cut|expand|simplify|simpler|stronger|punchier|more\s+\w+|less\s+\w+|add|remove|replace|delete|swap|opening|hook|ending|closing|tone|first\s+line|last\s+line|too\s+(?:long|short|formal|casual|salesy))\b/;

const QUESTION_START =
  /^(?:what|why|how|when|where|who|which|whose|can\s+you|could\s+you|would\s+you|do\s+you|does|did|is|are|am\s+i|will|should|may\s+i|can\s+i|could\s+i)\b/;

function normalize(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function wordCount(value: string): number {
  return value.split(" ").filter(Boolean).length;
}

export function classifyTelegramIntent(text: string, hasActiveDraft: boolean): TelegramIntent {
  const value = normalize(text);
  if (!value) return "chitchat";

  if (CREATE_VERB_OBJECT.test(value) || CREATE_PHRASE.test(value)) return "create";
  if (CHITCHAT.test(value)) return "chitchat";
  // Only punctuation, digits or emoji: nothing to write about.
  if (!/[\p{L}]/u.test(value)) return "chitchat";

  const words = wordCount(value);
  const isQuestion = value.endsWith("?") || QUESTION_START.test(value);

  if (hasActiveDraft && REVISE.test(value) && words <= 40) return "revise";
  if (isQuestion) return "question";

  if (hasActiveDraft) {
    // Short follow-ups ("I don't like this opening") edit the draft. A long
    // message with no edit wording may be a brand-new idea, so confirm.
    return words >= 12 ? "vague" : "revise";
  }
  // No draft to edit: a substantive message is a topic, a fragment is unclear.
  return words >= 8 ? "create" : "vague";
}
