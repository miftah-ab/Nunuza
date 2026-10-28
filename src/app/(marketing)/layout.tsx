import { MarketingHeader } from "@/components/layout/MarketingHeader";
import { MarketingFooter } from "@/components/layout/MarketingFooter";

/**
 * Shell layout for all public marketing pages: /, /pricing, /privacy, /terms, /login.
 * Provides the sticky header and footer; children fill the main content area.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
