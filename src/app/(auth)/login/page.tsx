import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { GoogleSignInButton } from "./GoogleSignInButton";
import "./login.css";

export const metadata: Metadata = {
  title: "Sign in — Nunuza",
  description: "Sign in to Nunuza with Google. No password required.",
  robots: { index: false, follow: false },
};

/** A malformed %-sequence in ?error= must not take the page down. */
function readError(raw: string | undefined): string | null {
  if (!raw) return null;
  let message = raw;
  try {
    message = decodeURIComponent(raw);
  } catch {
    // keep the raw value
  }
  return message.startsWith("AUTH_NOT_CONFIGURED") ? null : message;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const params = await searchParams;
  const displayError = readError(params.error);

  return (
    <div className="nzl">
      <header className="nzl-header">
        <Link href="/" className="nzl-back" aria-label="Back to home">
          <ArrowLeft size={18} aria-hidden="true" />
          <Logo height={24} asLink={false} />
        </Link>
      </header>

      <main id="main-content" className="nzl-main">
        <div className="nzl-card">
          <h1 className="nzl-title">Sign in to Nunuza</h1>
          <p className="nzl-sub">Use your Google account. No password required.</p>

          {displayError && (
            <div role="alert" className="nzl-error">
              <AlertCircle size={18} aria-hidden="true" />
              <p>{displayError}</p>
            </div>
          )}

          <form action="/auth/google" method="POST">
            <GoogleSignInButton />
          </form>

          {process.env.PUBLIC_SIGNUP_ENABLED !== "true" && (
            <p className="nzl-legal">
              New to Nunuza? <Link href="/early-access">Request early access</Link>.
            </p>
          )}

          <p className="nzl-legal">
            By signing in, you agree to Nunuza&apos;s{" "}
            <Link href="/terms">Terms of Service</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
