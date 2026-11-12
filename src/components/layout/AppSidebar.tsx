"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ChevronRight } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import { ENTITLEMENT_LABELS, isActivePath, navSections } from "@/components/layout/nav-items";
import type { Workspace } from "@/types/database";

interface AppSidebarProps {
  workspace: Workspace | null;
}

function WorkspaceInfo({
  workspace,
  entitlement,
}: {
  workspace: Workspace | null;
  entitlement: { label: string; color: string } | null;
}) {
  if (!workspace) return null;
  return (
    <div className="px-4 py-3 border-b border-border bg-surface/40">
      <p className="text-sm font-semibold text-ink truncate leading-tight">{workspace.name}</p>
      {entitlement && (
        <span className={cn(
          "inline-flex items-center mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border",
          entitlement.color
        )}>
          {entitlement.label}
        </span>
      )}
    </div>
  );
}

function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="POST">
      <button
        type="submit"
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-ink-secondary hover:bg-surface hover:text-ink transition-colors",
          className
        )}
      >
        <LogOut size={17} aria-hidden="true" className="shrink-0 text-ink-muted" />
        <span>Sign out</span>
      </button>
    </form>
  );
}

export function AppSidebar({ workspace }: AppSidebarProps) {
  const pathname = usePathname();

  const entitlement = workspace
    ? (ENTITLEMENT_LABELS[workspace.entitlement_type] ?? { label: workspace.entitlement_type, color: "bg-surface text-ink-secondary border-border" })
    : null;

  const renderNavLinks = () => (
    <nav aria-label="Application navigation" className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
      {navSections.map((section) => (
        <div key={section.title}>
          <p className="px-3 mb-1.5 text-[10px] font-semibold text-ink-muted uppercase tracking-widest">
            {section.title}
          </p>
          <ul role="list" className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      active
                        ? "bg-forest-light text-forest"
                        : "text-ink-secondary hover:bg-surface hover:text-ink"
                    )}
                  >
                    <Icon
                      size={17}
                      aria-hidden="true"
                      className={cn("shrink-0 transition-colors", active ? "text-forest" : "text-ink-muted")}
                    />
                    <span>{label}</span>
                    {active && (
                      <ChevronRight size={13} className="ml-auto text-forest/50" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* ─── Mobile header (< md). Navigation lives in the bottom tab bar. ─── */}
      <header className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-border sticky top-0 z-30">
        <Logo height={22} />
        {entitlement && (
          <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", entitlement.color)}>
            {entitlement.label}
          </span>
        )}
      </header>

      {/* ─── Desktop Sidebar (md+) ─── */}
      <aside
        className="hidden md:flex flex-col w-60 flex-shrink-0 bg-white border-r border-border h-screen sticky top-0"
        aria-label="Application navigation"
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-border shrink-0">
          <Logo height={24} />
        </div>

        <WorkspaceInfo workspace={workspace} entitlement={entitlement} />
        {renderNavLinks()}

        {/* Footer */}
        <div className="p-3 border-t border-border shrink-0">
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}
