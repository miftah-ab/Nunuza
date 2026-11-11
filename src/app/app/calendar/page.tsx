import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CalendarDays } from "lucide-react";
import { PublishingCalendar } from "@/components/calendar/PublishingCalendar";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";
import type { ContentPost } from "@/types/database";

export const metadata: Metadata = {
  title: "Publishing Calendar — Nunuza",
  robots: { index: false, follow: false },
};

export default async function CalendarPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const supabase = await createClient();
  let posts: ContentPost[] = [];
  let queryError: string | null = null;

  const { data, error } = await supabase
    .from("content_posts")
    .select("id, text, internal_title, pillar, scheduled_at")
    .eq("workspace_id", workspace.id)
    .eq("status", "scheduled")
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });

  if (error) {
    queryError = "Scheduled posts could not be loaded. Please refresh and try again.";
  } else {
    posts = (data ?? []) as ContentPost[];
  }

  const initialMonth = new Date();
  initialMonth.setDate(1);
  initialMonth.setHours(12, 0, 0, 0);

  return (
    <div className="mx-auto max-w-6xl animate-fade-in pb-12">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-forest">
            <CalendarDays size={18} />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Publishing
            </span>
          </div>
          <h1 className="text-2xl font-bold text-ink">Calendar</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            See exactly when your approved LinkedIn posts are scheduled to publish.
          </p>
        </div>
        <Link href="/app/content" className="btn-secondary self-start text-xs">
          Manage content
        </Link>
      </div>

      {queryError ? (
        <div className="card border-error-light bg-error-light/30 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-error">
            <AlertCircle size={17} />
            <span>Calendar unavailable</span>
          </div>
          <p className="mt-1 text-xs text-ink-secondary">{queryError}</p>
        </div>
      ) : (
        <PublishingCalendar
          posts={posts.map((post) => ({
            id: post.id,
            text: post.text,
            internal_title: post.internal_title,
            pillar: post.pillar,
            scheduled_at: post.scheduled_at!,
          }))}
          initialMonth={initialMonth.toISOString()}
        />
      )}
    </div>
  );
}
