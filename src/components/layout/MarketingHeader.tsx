"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy", href: "/privacy" },
];

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-sm border-b border-border">
      <div className="container-page">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Logo height={28} />

          {/* Desktop nav */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-ink-secondary hover:text-ink transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-ink-secondary hover:text-ink transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              id="header-cta"
              className="btn-primary text-sm px-4 py-2"
            >
              Try the draft-only preview
            </Link>
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            id="mobile-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="md:hidden btn-ghost p-2"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <X size={20} aria-hidden="true" />
            ) : (
              <Menu size={20} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          id="mobile-menu"
          role="dialog"
          aria-label="Mobile navigation"
          className="md:hidden border-t border-border bg-white animate-fade-in"
        >
          <div className="container-page py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm text-ink-secondary hover:text-ink hover:bg-offwhite transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm text-ink-secondary hover:text-ink hover:bg-offwhite transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="btn-primary text-sm text-center"
              >
                Try the draft-only preview
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
