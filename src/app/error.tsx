"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Only the digest is logged: it ties this to the server log without
    // exposing the message to anyone watching the console.
    console.error("[ui] Page crashed", error.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 text-center">
      <div className="mb-8">
        <Logo />
      </div>
      <h1 className="text-2xl font-bold text-ink mb-2">Something went wrong</h1>
      <p className="text-ink-secondary mb-8 max-w-sm">
        We couldn&apos;t load this page. Your work is saved. Try again, and if it keeps happening, contact support.
      </p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Back to home
        </Link>
      </div>
    </div>
  );
}
