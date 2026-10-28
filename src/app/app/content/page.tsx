import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { listPosts } from "@/lib/db/posts";
import { checkDraftLimit, MONTHLY_DRAFT_LIMIT } from "@/lib/db/usage";
import { ContentManager } from "@/components/content/ContentManager";

export const metadata: Metadata = {
  title: "Content & Drafts",
  robots: { index: false, follow: false },
};

export default async function ContentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch {
    redirect("/app/onboarding");
  }

  // Fetch initial posts and draft usage
  const [posts, usage] = await Promise.all([
    listPosts(workspace.id, { limit: 100 }),
    checkDraftLimit(workspace.id),
  ]);

  return (
    <div className="max-w-5xl mx-auto animate-fade-in pb-12">
      <ContentManager
        initialPosts={posts}
        workspace={workspace}
        usageCount={usage.count}
        usageLimit={MONTHLY_DRAFT_LIMIT}
      />
    </div>
  );
}
