"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

const navLinks = [
  { label: "Product", href: "/#product" },
  { label: "Why Nunuza", href: "/#difference-heading" },
  { label: "Integrations", href: "/#integrations-heading" },
  { label: "Pricing", href: "/#pricing" },
];

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-white/95 backdrop-blur-md">
      <div className="container-page">
        <div className="flex h-[68px] items-center justify-between">
          <Logo height={29} />
          <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-[13px] font-medium text-ink-secondary transition-colors hover:text-forest">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-5 md:flex">
            <Link href="/login" className="text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink">Sign in</Link>
            <Link href="/login" id="header-cta" className="btn-primary px-4 py-2.5 text-[13px]">
              Start free trial <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <button
            type="button"
            id="mobile-menu-toggle"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
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
        <nav id="mobile-menu" aria-label="Mobile navigation" className="animate-fade-in border-t border-border bg-white shadow-lg shadow-ink/5 md:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} onClick={closeMenu} className="rounded-lg px-3 py-3 text-sm font-medium text-ink-secondary transition-colors hover:bg-offwhite hover:text-forest">
                {link.label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Link href="/login" onClick={closeMenu} className="btn-secondary justify-center text-sm">Sign in</Link>
              <Link href="/login" onClick={closeMenu} className="btn-primary justify-center text-sm">Start free trial</Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
