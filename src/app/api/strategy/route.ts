import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import {
  getContentStrategy,
  upsertContentStrategy,
  logAuditEvent,
} from "@/lib/db/workspace";

interface StrategyUpdateBody {
  audienceRoles?: string;
  audienceProblems?: string;
  audienceOutcomes?: string;
  founderRole?: string;
  company?: string;
  positioning?: string;
  linkedinUrl?: string;
  goals?: string[];
  pillars?: string[];
  exclusions?: string[];
  ctaPreferences?: string[];
  cadencePerWeek?: number;
  preferredDays?: number[];
  preferredTime?: string | null;
  timezone?: string;
}

const cleanText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

const cleanList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean))].slice(0, maxItems);
};

export async function PATCH(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<StrategyUpdateBody>(request);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const cadencePerWeek = Number(body.cadencePerWeek);
    if (!Number.isInteger(cadencePerWeek) || cadencePerWeek < 1 || cadencePerWeek > 7) {
      return NextResponse.json({ error: "Posting cadence must be between 1 and 7 posts per week." }, { status: 400 });
    }

    const preferredDays = Array.isArray(body.preferredDays)
      ? [...new Set(body.preferredDays)]
      : [];
    if (preferredDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      return NextResponse.json({ error: "Choose one or more valid days of the week." }, { status: 400 });
    }

    const timezone = cleanText(body.timezone, 80) || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: "Enter a valid time zone, such as America/New_York." }, { status: 400 });
    }

    const preferredTime = body.preferredTime == null || body.preferredTime === ""
      ? null
      : cleanText(body.preferredTime, 5);
    if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
      return NextResponse.json({ error: "Preferred posting time must use 24-hour HH:MM format." }, { status: 400 });
    }

    const existing = await getContentStrategy(workspace.id);
    if (!existing) {
      return NextResponse.json({ error: "No content strategy exists for this workspace. Complete onboarding first." }, { status: 404 });
    }

    const linkedinUrl = cleanText(body.linkedinUrl, 300);
    if (linkedinUrl) {
      try {
        const parsedUrl = new URL(linkedinUrl);
        if (parsedUrl.protocol !== "https:" || !["linkedin.com", "www.linkedin.com"].includes(parsedUrl.hostname)) {
          throw new Error("invalid");
        }
      } catch {
        return NextResponse.json({ error: "Enter a valid HTTPS LinkedIn profile URL." }, { status: 400 });
      }
    }

    const audience = {
      ...(existing.audience ?? {}),
      roles: cleanText(body.audienceRoles, 500) || null,
      problems: cleanText(body.audienceProblems, 1200) || null,
      outcomes: cleanText(body.audienceOutcomes, 1200) || null,
      founder_role: cleanText(body.founderRole, 160) || null,
      company: cleanText(body.company, 160) || null,
      positioning: cleanText(body.positioning, 1200) || null,
      linkedin_url: linkedinUrl || null,
    };

    const strategy = await upsertContentStrategy(workspace.id, {
      audience,
      goals: cleanList(body.goals, 10, 240),
      pillars: cleanList(body.pillars, 12, 120),
      exclusions: cleanList(body.exclusions, 30, 160),
      cta_preferences: cleanList(body.ctaPreferences, 12, 160),
      cadence_per_week: cadencePerWeek,
      preferred_days: preferredDays,
      preferred_time: preferredTime,
      timezone,
    });

    await logAuditEvent({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: workspace.owner_user_id,
      action: "update_content_strategy",
      resourceType: "content_strategy",
      resourceId: strategy.id,
      safeMetadata: {
        strategyVersion: strategy.version,
        cadencePerWeek: strategy.cadence_per_week,
        pillarCount: strategy.pillars?.length ?? 0,
        exclusionCount: strategy.exclusions?.length ?? 0,
      },
    });

    return ok({ strategy });
  } catch (err) {
    return apiError(err);
  }
}
