import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { AlertCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Nunuza with Google. No password required.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error ? decodeURIComponent(params.error) : null;
  // Filter out internal error codes from user-visible messages
  const displayError =
    errorMessage && !errorMessage.startsWith("AUTH_NOT_CONFIGURED")
      ? errorMessage
      : null;

  return (
    <div className="min-h-screen bg-offwhite flex flex-col">
      {/* Minimal header — logo only, no nav */}
      <header className="flex items-center justify-center h-16 border-b border-border bg-white">
        <Logo height={28} />
      </header>

      {/* Auth card */}
      <main
        id="main-content"
        className="flex-1 flex items-center justify-center px-4 py-12"
      >
        <div className="w-full max-w-sm">
          <div className="card p-8 text-center">
            {/* Heading */}
            <h1 className="text-xl font-bold text-ink mb-2">
              Sign in to Nunuza
            </h1>
            <p className="text-sm text-ink-secondary mb-8">
              Use your Google account to sign in or create a workspace. No
              password required.
            </p>

            {/* OAuth error banner */}
            {displayError && (
              <div className="mb-6 flex items-start gap-2.5 rounded-lg bg-error-light border border-error/20 px-4 py-3 text-sm text-error text-left">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p>{displayError}</p>
              </div>
            )}

            {/* Google sign-in button
                Phase 2 will wire this to Supabase Auth.
                For Phase 1, the button is present but the route handler
                is a BLOCKED stub — Supabase is not yet configured.
            */}
            <form action="/auth/google" method="POST">
              <button
                type="submit"
                id="google-signin-btn"
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border bg-white text-sm font-medium text-ink hover:bg-offwhite transition-colors focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2"
                aria-label="Continue with Google"
              >
                {/* Google "G" icon */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                    fill="#4285F4"
                  />
                  <path
                    d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
                    fill="#34A853"
                  />
                  <path
                    d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </button>
            </form>

            {/* Integration status — honest about blocked state */}
            <div className="mt-5 rounded-lg bg-offwhite border border-border px-4 py-3 text-left">
              <p className="text-xs text-ink-secondary">
                <strong className="text-ink">Integration status:</strong>{" "}
                Google sign-in requires Supabase configuration (Phase 2).
                The button UI is complete; the backend will be wired in the
                next increment. This page will not be deployed until the
                auth integration is verified.
              </p>
            </div>

            {/* Disclosures */}
            <p className="mt-6 text-xs text-ink-secondary">
              By signing in, you agree to Nunuza&apos;s{" "}
              <Link href="/terms" className="underline underline-offset-2">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <p className="mt-6 text-center text-sm text-ink-secondary">
            Draft-only preview · No payment card required
          </p>

          <div className="mt-4 text-center">
            <Link
              href="/"
              className="text-sm text-ink-secondary hover:text-ink transition-colors"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
