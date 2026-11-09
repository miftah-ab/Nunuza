"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Calendar,
  Target,
  Mic2,
  BarChart2,
  Activity,
  Plug,
  Shield,
  Settings,
  CreditCard,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/database";

interface AppSidebarProps {
  workspace: Workspace | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/app/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/app/content", label: "Content", icon: FileText },
      { href: "/app/calendar", label: "Calendar", icon: Calendar },
      { href: "/app/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    title: "Strategy",
    items: [
      { href: "/app/permissions", label: "Autopilot", icon: Shield },
      { href: "/app/strategy", label: "Strategy", icon: Target },
      { href: "/app/voice", label: "Voice", icon: Mic2 },
      { href: "/app/performance", label: "Performance", icon: BarChart2 },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/app/integrations", label: "Integrations", icon: Plug },
      { href: "/app/settings", label: "Settings", icon: Settings },
      { href: "/app/billing", label: "Billing", icon: CreditCard },
    ],
  },
];

const ENTITLEMENT_LABELS: Record<string, { label: string; color: string }> = {
  internal_beta: { label: "Private Beta", color: "bg-forest-light text-forest border-forest-muted" },
  publishing_beta: { label: "Private Beta", color: "bg-forest-light text-forest border-forest-muted" },
  internal_test: { label: "Internal Beta", color: "bg-forest-light text-forest border-forest-muted" },
  paid_trial: { label: "Trial Active", color: "bg-success-light text-success border-success/20" },
  paid_active: { label: "Nunuza Solo", color: "bg-success-light text-success border-success/20" },
  suspended: { label: "Suspended", color: "bg-error-light text-error border-error/20" },
  expired: { label: "Trial Expired", color: "bg-error-light text-error border-error/20" },
  draft_only: { label: "Onboarding", color: "bg-surface text-ink-secondary border-border" },
  inactive: { label: "Inactive", color: "bg-surface text-ink-secondary border-border" },
};

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
  const [mobileOpen, setMobileOpen] = useState(false);

  const entitlement = workspace
    ? (ENTITLEMENT_LABELS[workspace.entitlement_type] ?? { label: workspace.entitlement_type, color: "bg-surface text-ink-secondary border-border" })
    : null;

  const renderNavLinks = (onItemClick?: () => void) => (
    <nav aria-label="Application navigation" className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
      {navSections.map((section) => (
        <div key={section.title}>
          <p className="px-3 mb-1.5 text-[10px] font-semibold text-ink-muted uppercase tracking-widest">
            {section.title}
          </p>
          <ul role="list" className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onItemClick}
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
      {/* ─── Mobile Header (< md) ─── */}
      <header className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-border sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            className="p-2 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
          >
            <Menu size={20} />
          </button>
          <Logo height={22} />
        </div>

        {entitlement && (
          <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", entitlement.color)}>
            {entitlement.label}
          </span>
        )}
      </header>

      {/* ─── Mobile Slide-over Drawer ─── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div className="relative flex flex-col max-w-[280px] w-full bg-white shadow-xl animate-slide-in">
            {/* Drawer header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
              <Logo height={22} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <WorkspaceInfo workspace={workspace} entitlement={entitlement} />
            {renderNavLinks(() => setMobileOpen(false))}

            <div className="p-3 border-t border-border">
              <SignOutButton />
            </div>
          </div>
        </div>
      )}

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
