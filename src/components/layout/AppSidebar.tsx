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
      { href: "/app/overview",     label: "Overview",     icon: LayoutDashboard },
      { href: "/app/content",      label: "Content",      icon: FileText },
      { href: "/app/calendar",     label: "Calendar",     icon: Calendar },
      { href: "/app/activity",     label: "Activity",     icon: Activity },
    ],
  },
  {
    title: "Automation & Strategy",
    items: [
      { href: "/app/permissions",  label: "Permissions & Autopilot",  icon: Shield },
      { href: "/app/strategy",     label: "Strategy",     icon: Target },
      { href: "/app/voice",        label: "Voice Profile",icon: Mic2 },
      { href: "/app/performance",  label: "Performance",  icon: BarChart2 },
    ],
  },
  {
    title: "Settings & Billing",
    items: [
      { href: "/app/integrations", label: "Integrations", icon: Plug },
      { href: "/app/settings",     label: "Settings",     icon: Settings },
      { href: "/app/billing",      label: "Billing",      icon: CreditCard },
    ],
  },
];

const ENTITLEMENT_LABELS: Record<string, string> = {
  internal_beta:   "Private Beta",
  publishing_beta: "Private Beta",
  internal_test:   "Internal Beta",
  paid_trial:      "14-Day Trial",
  paid_active:     "Nunuza Solo",
  suspended:       "Suspended",
  expired:         "Trial Expired",
  draft_only:      "Onboarding",
  inactive:        "Inactive",
};

export function AppSidebar({ workspace }: AppSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const entitlementLabel = workspace
    ? (ENTITLEMENT_LABELS[workspace.entitlement_type] ?? workspace.entitlement_type)
    : null;

  const isBeta =
    workspace?.entitlement_type === "internal_beta" ||
    workspace?.entitlement_type === "publishing_beta";
  const isPaid = workspace?.entitlement_type?.startsWith("paid");

  const badgeStyle = isBeta
    ? "bg-forest-light text-forest border border-forest-muted font-semibold"
    : isPaid
    ? "bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold"
    : "bg-amber-50 text-amber-800 border border-amber-200 font-medium";

  const renderNavLinks = (onItemClick?: () => void) => (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
      {navSections.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-3 text-[11px] font-semibold text-ink-secondary/70 uppercase tracking-wider">
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
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                      active
                        ? "bg-forest-light text-forest font-semibold"
                        : "text-ink-secondary hover:bg-surface hover:text-ink"
                    )}
                  >
                    <Icon size={16} aria-hidden="true" className={active ? "text-forest" : "text-ink-secondary"} />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* ─── Mobile Header (Visible on < md) ─── */}
      <header className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-border sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-1.5 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
          >
            <Menu size={20} />
          </button>
          <Logo height={22} />
        </div>

        {entitlementLabel && (
          <span className={cn("text-[11px] px-2 py-0.5 rounded-full", badgeStyle)}>
            {entitlementLabel}
          </span>
        )}
      </header>

      {/* ─── Mobile Drawer Overlay (Visible on < md when mobileOpen) ─── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-ink/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer content */}
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white shadow-xl">
            {/* Drawer Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border">
              <Logo height={22} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Workspace info badge */}
            {workspace && (
              <div className="px-4 py-3 bg-surface/50 border-b border-border">
                <p className="text-xs font-semibold text-ink truncate">{workspace.name}</p>
                {entitlementLabel && (
                  <span className={cn("inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full", badgeStyle)}>
                    {entitlementLabel}
                  </span>
                )}
              </div>
            )}

            {/* Drawer Links */}
            {renderNavLinks(() => setMobileOpen(false))}

            {/* Drawer Footer / Sign Out */}
            <div className="p-3 border-t border-border">
              <form action="/auth/signout" method="POST">
                <button
                  type="submit"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
                >
                  <LogOut size={16} aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─── Desktop Sidebar (Hidden on < md, visible on md+) ─── */}
      <aside
        className="hidden md:flex flex-col w-64 flex-shrink-0 bg-white border-r border-border h-screen sticky top-0"
        aria-label="Application navigation"
      >
        {/* Logo header */}
        <div className="h-16 flex items-center px-5 border-b border-border">
          <Logo height={24} />
        </div>

        {/* Workspace identifier & entitlement badge */}
        {workspace && (
          <div className="px-5 py-3 border-b border-border bg-surface/30">
            <p className="text-xs font-semibold text-ink truncate">{workspace.name}</p>
            {entitlementLabel && (
              <div className="mt-1">
                <span className={cn("inline-block text-[11px] px-2 py-0.5 rounded-full", badgeStyle)}>
                  {entitlementLabel}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Nav Links */}
        {renderNavLinks()}

        {/* Desktop Footer / Sign Out */}
        <div className="p-3 border-t border-border bg-white">
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
            >
              <LogOut size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
