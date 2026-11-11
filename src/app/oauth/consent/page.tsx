import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Authorize Claude — Nunuza",
  robots: { index: false, follow: false },
};

type AuthorizationDetails = {
  authorization_id: string;
  client: { name: string; uri?: string; logo_uri?: string };
  redirect_uri: string;
  scope?: string;
};

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id: authorizationId } = await searchParams;

  if (!authorizationId || authorizationId.length > 200) {
    return <ConsentError message="This authorization request is missing or invalid. Return to Claude and try connecting again." />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !data) {
    return <ConsentError message="We couldn't verify this authorization request. Return to Claude and start again." />;
  }

  if (!("authorization_id" in data)) {
    redirect(data.redirect_url);
  }

  const details = data as AuthorizationDetails;
  const scopes = (details.scope || "").split(/\s+/).filter(Boolean);
  const displayName = details.client?.name || "Claude";

  return (
    <main className="min-h-screen bg-[#F7F8F7] px-4 py-12 text-[#172B25]">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold tracking-[0.18em] text-[#267253]">NUNUZA</p>
          <h1 className="mt-4 text-2xl font-semibold">Connect {displayName}</h1>
          <p className="mt-2 text-sm leading-6 text-[#62716B]">
            Review what this AI connector can do in your Nunuza workspace.
          </p>
        </div>

        <section className="rounded-2xl border border-[#DDE5E0] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 border-b border-[#E8EEEA] pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF3EE] text-lg font-semibold text-[#267253]">
              N
            </div>
            <div className="min-w-0">
              <p className="font-semibold">{displayName}</p>
              <p className="mt-0.5 break-all text-xs text-[#718078]">{details.redirect_uri}</p>
            </div>
          </div>

          <div className="py-5">
            <h2 className="text-sm font-semibold">Requested access</h2>
            <ul className="mt-3 space-y-3 text-sm text-[#4D5D55]">
              <li className="flex gap-2"><span className="text-[#267253]">✓</span><span>Read your Nunuza workspace status, content plan, drafts, schedule, and performance summaries.</span></li>
              <li className="flex gap-2"><span className="text-[#267253]">✓</span><span>Create, edit, revise, and reject drafts; pause or resume your agent.</span></li>
              <li className="flex gap-2"><span className="text-[#267253]">✓</span><span>Schedule posts that you have already approved.</span></li>
              <li className="flex gap-2"><span className="text-[#267253]">✓</span><span>Cancel scheduled posts.</span></li>
            </ul>
            <div className="mt-4 rounded-lg bg-[#F3F6F4] p-3 text-xs leading-5 text-[#53645B]">
              Claude cannot approve drafts or bypass Nunuza&apos;s human-approval rules. You can disconnect this integration from Claude at any time.
            </div>
            {scopes.length > 0 && (
              <p className="mt-4 text-xs text-[#718078]">
                Identity scopes requested by the connector: {scopes.join(", ")}
              </p>
            )}
          </div>

          <form action="/api/oauth/decision" method="POST" className="flex flex-col-reverse gap-2 border-t border-[#E8EEEA] pt-5 sm:flex-row">
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 rounded-lg border border-[#D7E0DA] px-4 py-3 text-sm font-medium text-[#526159] hover:bg-[#F7F9F7]"
            >
              Deny
            </button>
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 rounded-lg bg-[#267253] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E5F44]"
            >
              Approve access
            </button>
          </form>
        </section>

        <p className="mt-5 text-center text-xs text-[#7B8982]">
          Signed in as {user.email || "your Nunuza account"}. Never approve a connector you don&apos;t recognize.
        </p>
      </div>
    </main>
  );
}

function ConsentError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F8F7] px-4 text-[#172B25]">
      <div className="w-full max-w-md rounded-2xl border border-[#DDE5E0] bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Authorization unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[#62716B]">{message}</p>
        <a href="https://claude.ai/settings/connectors" className="mt-5 inline-flex text-sm font-semibold text-[#267253] underline">
          Return to Claude
        </a>
      </div>
    </main>
  );
}
