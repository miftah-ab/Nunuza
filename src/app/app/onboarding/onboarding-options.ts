/**
 * Choices and payload mapping for the tap-to-answer onboarding.
 *
 * Every answer is a chip the user taps, with a free-text "Other" for anything
 * the chips miss. The answers map onto the existing onboarding API fields, so
 * the voice profile and content strategy the AI uses are filled in exactly as
 * before, just without asking people to write paragraphs.
 */

export const ROLE_OPTIONS = [
  "Founder or CEO",
  "Consultant or coach",
  "Marketer",
  "Recruiter or HR",
  "Sales",
  "Engineer or product",
  "Creator or writer",
] as const;

export const GOAL_OPTIONS = [
  "Get clients",
  "Hire talent",
  "Build my personal brand",
  "Share my expertise",
  "Grow my network",
  "Promote my product",
] as const;

export const AUDIENCE_OPTIONS = [
  "Founders",
  "Executives",
  "Hiring managers",
  "Developers",
  "Marketers",
  "Small business owners",
] as const;

export const TONE_OPTIONS = [
  { value: "Direct and clear", hint: "Gets to the point" },
  { value: "Warm and friendly", hint: "Like talking to a colleague" },
  { value: "Professional", hint: "Polished and credible" },
  { value: "Bold and opinionated", hint: "Takes a stand" },
  { value: "Story-driven", hint: "Lessons from real moments" },
] as const;

export const CADENCE_OPTIONS = [
  { value: 1, label: "1 a week", hint: "Light" },
  { value: 3, label: "3 a week", hint: "Steady" },
  { value: 5, label: "5 a week", hint: "Every weekday" },
] as const;

const GENERIC_TOPICS = [
  "Lessons from my work",
  "Mistakes and what I learned",
  "Behind the scenes",
  "Industry trends",
  "Practical how-to tips",
  "Customer stories",
];

const TOPICS_BY_ROLE: Record<string, string[]> = {
  "Founder or CEO": ["Founder stories", "Building in public", "Hiring and team culture", "Lessons from customers"],
  "Consultant or coach": ["Client results", "Frameworks that work", "Common mistakes I see", "Advice for people starting out"],
  Marketer: ["Campaign breakdowns", "What actually converts", "Brand and positioning", "Marketing myths"],
  "Recruiter or HR": ["Hiring lessons", "Interview tips", "Career advice", "Workplace culture"],
  Sales: ["Sales lessons", "Customer conversations", "Deals won and lost", "Selling without being pushy"],
  "Engineer or product": ["Engineering lessons", "Product decisions", "Tools and workflows", "Lessons from shipping"],
  "Creator or writer": ["Writing and ideas", "Creative process", "Growing an audience", "What I'm learning"],
};

/** Topic chips tailored to the person's role, then padded with general ones. */
export function suggestTopics(roles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  };
  for (const role of roles) (TOPICS_BY_ROLE[role] ?? []).forEach(push);
  GENERIC_TOPICS.forEach(push);
  return out.slice(0, 8);
}

/** Trims, strips control characters and caps length. Used for every free-text answer. */
export function cleanAnswer(value: string, max = 80): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface OnboardingAnswers {
  displayName: string;
  roles: string[];
  goals: string[];
  audience: string[];
  topics: string[];
  tones: string[];
  postsPerWeek: number;
  timezone: string;
}

const list = (values: string[], max = 6) =>
  values.map((v) => cleanAnswer(v)).filter(Boolean).slice(0, max);

/** Maps the tapped answers onto the fields the onboarding API already stores. */
export function buildOnboardingPayload(a: OnboardingAnswers) {
  const roles = list(a.roles, 2);
  const goals = list(a.goals);
  const audience = list(a.audience);
  const topics = list(a.topics, 8);
  const tones = list(a.tones, 2);
  return {
    displayName: cleanAnswer(a.displayName, 60) || undefined,
    role: roles[0],
    positioning: roles.length ? roles.join(", ") : undefined,
    primaryGoal: goals.length ? goals.join(", ") : undefined,
    audienceRoles: audience.length ? audience.join(", ") : undefined,
    pillars: topics.length ? topics.join("\n") : undefined,
    tone: tones.length ? tones.join(", ") : undefined,
    postsPerWeek: a.postsPerWeek,
    preferredDays: [1, 2, 3, 4, 5],
    timezone: a.timezone,
  };
}
