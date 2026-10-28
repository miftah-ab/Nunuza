import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-offwhite flex flex-col items-center justify-center px-4 text-center">
      <p className="text-8xl font-bold text-forest-muted mb-4" aria-hidden="true">
        404
      </p>
      <h1 className="text-2xl font-bold text-ink mb-2">Page not found</h1>
      <p className="text-ink-secondary mb-8 max-w-sm">
        This page doesn&apos;t exist or has been moved.
      </p>
      <Link href="/" className="btn-primary">
        Back to home
      </Link>
    </div>
  );
}
