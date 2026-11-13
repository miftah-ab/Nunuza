import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { GoogleSignInButton } from "./GoogleSignInButton";
import "./login.css";

export const metadata: Metadata = {
  title: "Sign in — Nunuza",
  description: "Sign in to Nunuza with Google. No password required.",
  robots: { index: false, follow: false },
};

type LoginError = "early_access_required" | "sign_in_cancelled" | "invalid_sign_in_link" | "sign_in_failed";

const LOGIN_ERRORS: Record<LoginError, string> = {
  early_access_required: "Nunuza is currently available to approved users only. Join the waitlist to request access. We’ll notify you when access becomes available.",
  sign_in_cancelled: "Sign-in was cancelled. You can try again whenever you’re ready.",
  invalid_sign_in_link: "This sign-in link is invalid or expired. Please start again.",
  sign_in_failed: "We couldn’t complete sign-in. Please try again. If the problem continues, contact support.",
};

/** Only render known, safe error messages. Never echo provider or query-string text. */
function readError(raw: string | undefined): { code: LoginError; message: string } | null {
  if (!raw || !(raw in LOGIN_ERRORS)) return raw ? { code: "sign_in_failed", message: LOGIN_ERRORS.sign_in_failed } : null;
  const code = raw as LoginError;
  return { code, message: LOGIN_ERRORS[code] };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const params = await searchParams;
  const displayError = readError(params.error);
  const earlyAccessRequired = displayError?.code === "early_access_required";

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
            <div role="alert" className={earlyAccessRequired ? "nzl-error nzl-access-notice" : "nzl-error"}>
              {earlyAccessRequired ? (
                <ShieldCheck size={19} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <div className="nzl-error-content">
                {earlyAccessRequired && <strong>Early access is currently limited</strong>}
                <p>{displayError.message}</p>
                {earlyAccessRequired && (
                  <Link href="/early-access" className="nzl-access-link">
                    Join the waitlist
                  </Link>
                )}
              </div>
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
