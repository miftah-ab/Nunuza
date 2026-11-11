import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

const footerGroups = [
  {
    title: "Explore",
    links: [
      { label: "Product", href: "/#product" },
      { label: "Why Nunuza", href: "/#difference-heading" },
      { label: "Pricing", href: "/pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Your account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Start free trial", href: "/login" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-[#F8F8F5]">
      <div className="container-page py-12 md:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo height={27} asLink={false} />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-secondary">
              A strategy-led LinkedIn content workflow for people building something of their own.
            </p>
            <p className="mt-3 text-xs text-ink-muted">14-day trial · $29/month after trial</p>
          </div>
          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.13em] text-ink">{group.title}</h2>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-ink-secondary transition-colors hover:text-forest">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-secondary">© {year} Nunuza. All rights reserved.</p>
          <p className="text-xs text-ink-muted">Your strategy. Your voice. Your publishing decisions.</p>
        </div>
      </div>
    </footer>
  );
}
