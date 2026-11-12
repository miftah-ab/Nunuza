"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#E7EBE6] bg-white/95 backdrop-blur-md">
      <div className="container-page">
        <div className="flex h-[68px] items-center justify-between">
          <Logo height={29} />
          <div className="hidden items-center gap-6 md:flex">
            <Link href="/login" className="text-[13px] font-medium text-[#68716C] transition-colors hover:text-[#202522]">Log in</Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-full bg-[#174C3C] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#103B2F]">Message Nunuza <span aria-hidden="true">↗</span></Link>
          </div>
          <button type="button" aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={menuOpen} aria-controls="mobile-menu" className="btn-ghost p-2 md:hidden" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {menuOpen && <nav id="mobile-menu" aria-label="Mobile navigation" className="animate-fade-in border-t border-[#E7EBE6] bg-white shadow-lg shadow-ink/5 md:hidden"><div className="container-page flex flex-col gap-1 py-3"><Link href="/login" onClick={closeMenu} className="rounded-lg px-3 py-3 text-sm font-medium text-[#68716C] hover:bg-[#F8F8F5]">Log in</Link><Link href="/login" onClick={closeMenu} className="mt-2 inline-flex justify-center rounded-full bg-[#174C3C] px-5 py-3 text-sm font-semibold text-white">Message Nunuza</Link></div></nav>}
    </header>
  );
}
