import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError } from "@/lib/api/respond";
import { aiService } from "@/lib/ai/service";
import { getContentStrategy, getVoiceProfile } from "@/lib/db/workspace";
import { listPosts } from "@/lib/db/posts";
import { createClient } from "@/lib/supabase/server";

function flattenText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(flattenText)
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function profileValue(profile: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!profile) return undefined;
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 180);
  }
  return undefined;
}

function makePeopleSearches(audience: string, industry: string, workspaceName: string) {
  const niche = industry || workspaceName || audience || "your industry";
  const target = audience || niche;
  const searches = [
    {
      id: "customers",
      label: "Potential customers",
      description: "Find decision-makers and buyers who match your target audience.",
      query: `${target} decision maker`,
    },
    {
      id: "voices",
      label: "Industry voices",
      description: "Find practitioners and creators whose conversations are relevant to your space.",
      query: `${niche} industry expert OR creator`,
    },
    {
      id: "partners",
      label: "Potential collaborators",
      description: "Find founders, consultants, and partners working in adjacent areas.",
      query: `${niche} founder OR consultant OR partner`,
    },
  ];
  return searches.map((item) => ({
    ...item,
    url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(item.query)}`,
  }));
}

export async function POST() {
  try {
    const workspace = await requireWorkspace();
    const supabase = await createClient();

    const [voice, strategy, profileResult, connectionResult, recentPosts] = await Promise.all([
      getVoiceProfile(workspace.id),
      getContentStrategy(workspace.id),
      supabase.from("profiles").select("*").eq("id", workspace.owner_user_id).maybeSingle(),
      supabase.from("integration_connections").select("status, metadata").eq("workspace_id", workspace.id).eq("provider", "linkedin").maybeSingle(),
      listPosts(workspace.id, { excludeCanceled: true, limit: 12, orderBy: "updated_at", orderDir: "desc" }),
    ]);

    if (profileResult.error) throw new Error("We couldn’t read your workspace profile.");
    if (connectionResult.error) throw new Error("We couldn’t check your LinkedIn connection.");

    const profile = (profileResult.data ?? null) as Record<string, unknown> | null;
    const metadata = (connectionResult.data?.metadata ?? null) as Record<string, unknown> | null;
    const role = profileValue(profile, ["headline", "job_title", "role", "position", "professional_title"])
      ?? profileValue(metadata, ["headline", "job_title", "role"]);
    const displayName = profileValue(profile, ["display_name", "full_name", "name"])
      ?? profileValue(metadata, ["name"]);
    const company = profileValue(profile, ["company_name", "company", "organization"])
      ?? workspace.name;
    const industry = profileValue(profile, ["industry", "industry_name"]);
    const audienceText = flattenText(strategy?.audience).slice(0, 700);
    const goals = strategy?.goals ?? [];
    const pillars = Array.isArray(strategy?.pillars)
      ? strategy.pillars.map((pillar) => typeof pillar === "string" ? pillar : flattenText(pillar)).filter(Boolean)
      : [];
    const recentTitles = recentPosts
      .map((post) => post.internal_title?.trim())
      .filter((title): title is string => Boolean(title))
      .slice(0, 8);

    const generated = await aiService.generatePlan({
      periodStart: new Date().toISOString().slice(0, 10),
      periodDays: 14,
      cadencePerWeek: 7,
      strategy: {
        audience: strategy?.audience ?? (audienceText ? { summary: audienceText } : undefined),
        goals: [
          ...goals,
          ...(recentTitles.length ? [`Avoid repeating these recent post topics: ${recentTitles.join("; ")}`] : []),
        ],
        pillars,
        exclusions: strategy?.exclusions ?? voice?.exclusions ?? [],
        ctaPreferences: strategy?.cta_preferences ?? [],
      },
      voiceProfile: voice ? {
        tone: voice.tone,
        sentenceLength: voice.sentence_length,
        formality: voice.formality,
        phrasesUse: voice.phrases_use,
        phrasesAvoid: voice.phrases_avoid,
        sampleText: voice.sample_text,
        exclusions: voice.exclusions,
      } : undefined,
      userRole: role ?? industry ?? company ?? "Professional",
    });

    const ideas = generated.topics.slice(0, 8).map((topic, index) => ({
      id: `idea-${index + 1}`,
      title: topic.title,
      angle: topic.angle,
      pillar: topic.pillar,
      targetFormat: topic.targetFormat,
      reason: audienceText
        ? `Selected to speak to your defined audience: ${audienceText.slice(0, 150)}`
        : `Selected to support your workspace goals and content direction.`,
    }));

    const peopleSearches = makePeopleSearches(audienceText, industry ?? "", company);
    const contextParts = [
      role ? `Role: ${role}` : displayName ? `Profile: ${displayName}` : null,
      company ? `Organization: ${company}` : null,
      industry ? `Industry: ${industry}` : null,
      audienceText ? `Audience: ${audienceText}` : null,
      connectionResult.data?.status === "connected" ? "LinkedIn account: connected" : "LinkedIn account: not connected",
    ].filter(Boolean);

    return NextResponse.json({
      data: {
        ideas,
        peopleSearches,
        contextSummary: contextParts.join(" · ") || "Using your workspace strategy and recent content",
        linkedinConnected: connectionResult.data?.status === "connected",
        peopleDiscoveryMode: "linkedin_live_search",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
