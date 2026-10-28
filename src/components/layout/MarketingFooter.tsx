import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

const footerLinks = [
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-offwhite">
      <div className="container-page py-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Brand */}
          <div className="flex flex-col gap-2">
            <Logo height={24} asLink={false} />
            <p className="text-secondary text-ink-secondary max-w-xs">
              LinkedIn content operations for solo founders.
            </p>
            <p className="text-xs text-ink-secondary">
              Draft-only preview — no subscription required.
            </p>
          </div>

          {/* Links */}
          <nav aria-label="Footer navigation">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ink-secondary hover:text-ink transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-8 pt-6 border-t border-border">
          <p className="text-xs text-ink-secondary">
            © {year} Nunuza. This is a draft-only preview. Publishing and
            scheduling are not available in this release.
          </p>
        </div>
      </div>
    </footer>
  );
}
