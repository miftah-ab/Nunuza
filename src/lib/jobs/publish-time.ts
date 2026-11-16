/**
 * Picks the next moment an agent post should go out, using the workspace's
 * saved preferred time, preferred days (0 = Sunday) and timezone.
 */

export interface PublishTimePreferences {
  preferredTime?: string | null; // "HH:MM" in the workspace timezone
  preferredDays?: number[] | null; // 0 = Sunday ... 6 = Saturday; empty = any day
  timezone?: string | null; // IANA name, defaults to UTC
}

const DEFAULT_TIME = "09:00";
const SEARCH_DAYS = 9;

function validTimeZone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/** UTC instant for a wall-clock time in a timezone (handles DST shifts). */
function wallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(first, timeZone);
}

export function nextPublishTime(
  now: Date,
  preferences: PublishTimePreferences,
  minLeadMs = 0
): Date {
  const timeZone = validTimeZone(preferences.timezone);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(preferences.preferredTime ?? "") ?? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(DEFAULT_TIME)!;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const days = new Set((preferences.preferredDays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  const earliest = now.getTime() + minLeadMs;

  const today = zonedParts(now.getTime(), timeZone);
  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    // Calendar arithmetic on the local date (UTC used only as a date carrier).
    const local = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (days.size > 0 && !days.has(local.getUTCDay())) continue;
    const candidate = wallClockToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), hour, minute, timeZone);
    if (candidate >= earliest) return new Date(candidate);
  }
  return new Date(earliest);
}
