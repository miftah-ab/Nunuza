import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#E7EBE6] bg-white">
      <div className="container-page flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between">
        <Logo height={25} asLink={false} />
        <div className="flex items-center gap-5 text-xs text-[#68716C]">
          <Link href="/privacy" className="transition-colors hover:text-[#174C3C]">Privacy</Link>
          <Link href="/terms" className="transition-colors hover:text-[#174C3C]">Terms</Link>
          <span>© {year} Nunuza</span>
        </div>
      </div>
    </footer>
  );
}
