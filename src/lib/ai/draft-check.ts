/**
 * Deterministic pre-publish check for agent drafts.
 *
 * Posts that go out under Autopilot must not invent numbers or link to places
 * the research did not come from. This catches the two cheapest and most
 * damaging cases without another model call:
 *   - a figure (percent, money, large number) that is not in the source
 *   - a link that is not the source article or its publisher
 * Evergreen posts have no source, so any such figure or link is a problem.
 */

export interface DraftCheckSource {
  /** Title + evidence excerpt the draft may rely on. Empty for evergreen posts. */
  text: string;
  /** Article and publisher URLs the draft may link to. */
  urls: string[];
}

export interface DraftCheckResult {
  ok: boolean;
  issues: string[];
}

const URL_PATTERN = /https?:\/\/[^\s)>\]]+/gi;
const FIGURE_PATTERN = /[$€£]\s?\d[\d,.]*(?:\s?(?:k|m|bn|million|billion))?|\d[\d,.]*\s?(?:%|percent|million|billion)|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/gi;

function hostOf(value: string): string | null {
  try { return new URL(value.replace(/[.,;:!?]+$/, "")).hostname.replace(/^www\./, ""); } catch { return null; }
}

function normalizeFigure(figure: string): string {
  return figure.toLowerCase().replace(/[\s,$€£]/g, "").replace("percent", "%");
}

function isYear(figure: string): boolean {
  return /^(19|20)\d{2}$/.test(figure.trim());
}

export function checkDraftAgainstSource(text: string, source: DraftCheckSource): DraftCheckResult {
  const issues: string[] = [];

  const allowedHosts = new Set(source.urls.map(hostOf).filter((host): host is string => !!host));
  for (const url of text.match(URL_PATTERN) ?? []) {
    const host = hostOf(url);
    if (!host || !allowedHosts.has(host)) issues.push(`Links to ${host ?? url}, which is not the source.`);
  }

  const sourceFigures = new Set((source.text.match(FIGURE_PATTERN) ?? []).map(normalizeFigure));
  const sourceNumbers = source.text.replace(/,/g, "");
  for (const figure of text.match(FIGURE_PATTERN) ?? []) {
    if (isYear(figure)) continue;
    const normalized = normalizeFigure(figure);
    const digits = normalized.replace(/[^\d.]/g, "");
    if (sourceFigures.has(normalized) || (digits && sourceNumbers.includes(digits))) continue;
    issues.push(`States "${figure.trim()}", which is not in the source.`);
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)].slice(0, 5) };
}
