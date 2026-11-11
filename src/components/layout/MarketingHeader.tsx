"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

const navLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-white/95 backdrop-blur-sm">
      <div className="container-page">
        <div className="flex h-16 items-center justify-between">
          <Logo height={28} />

          <nav aria-label="Main navigation" className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-ink-secondary transition-colors hover:text-forest"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="text-sm text-ink-secondary transition-colors hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              id="header-cta"
              className="btn-primary px-4 py-2 text-sm"
            >
              Start free trial
            </Link>
          </div>

          <button
            type="button"
            id="mobile-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="btn-ghost p-2 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          id="mobile-menu"
          className="animate-fade-in border-t border-border bg-white md:hidden"
        >
          <nav aria-label="Mobile navigation" className="container-page flex flex-col gap-1 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-lg px-3 py-2.5 text-sm text-ink-secondary transition-colors hover:bg-offwhite hover:text-forest"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <Link
                href="/login"
                onClick={closeMenu}
                className="rounded-lg px-3 py-2.5 text-sm text-ink-secondary hover:bg-offwhite"
              >
                Sign in
              </Link>
              <Link
                href="/login"
                onClick={closeMenu}
                className="btn-primary justify-center text-sm"
              >
                Start free trial
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
