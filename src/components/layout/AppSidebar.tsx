"use client";

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
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/database";

interface AppSidebarProps {
  workspace: Workspace | null;
}

const navItems = [
  { href: "/app/overview",     label: "Overview",     icon: LayoutDashboard },
  { href: "/app/content",      label: "Content",      icon: FileText },
  { href: "/app/calendar",     label: "Calendar",     icon: Calendar },
  { href: "/app/strategy",     label: "Strategy",     icon: Target },
  { href: "/app/voice",        label: "Voice",        icon: Mic2 },
  { href: "/app/performance",  label: "Performance",  icon: BarChart2 },
  { href: "/app/activity",     label: "Activity",     icon: Activity },
];

const bottomNavItems = [
  { href: "/app/integrations", label: "Integrations", icon: Plug },
  { href: "/app/permissions",  label: "Permissions",  icon: Shield },
  { href: "/app/settings",     label: "Settings",     icon: Settings },
  { href: "/app/billing",      label: "Billing",      icon: CreditCard },
];

const ENTITLEMENT_LABELS: Record<string, string> = {
  draft_only:      "Draft-only preview",
  publishing_beta: "LinkedIn publishing beta",
  internal_test:   "Internal acceptance test",
  paid_trial:      "Trial",
  paid_active:     "Active",
  inactive:        "Inactive",
};

export function AppSidebar({ workspace }: AppSidebarProps) {
  const pathname = usePathname();

  const entitlementLabel = workspace
    ? (ENTITLEMENT_LABELS[workspace.entitlement_type] ?? workspace.entitlement_type)
    : null;

  return (
    <aside
      className="hidden md:flex flex-col w-60 flex-shrink-0 bg-white border-r border-border"
      aria-label="Application navigation"
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border">
        <Logo height={24} />
      </div>

      {/* Entitlement badge */}
      {entitlementLabel && (
        <div className="px-4 py-3 border-b border-border">
          <span className={cn(
            "text-xs font-medium px-2 py-1 rounded-full",
            workspace?.entitlement_type === "draft_only"
              ? "bg-forest-light text-forest"
              : workspace?.entitlement_type === "publishing_beta"
              ? "bg-warning-light text-warning"
              : workspace?.entitlement_type?.startsWith("paid")
              ? "bg-success-light text-success"
              : "bg-offwhite text-ink-secondary border border-border"
          )}>
            {entitlementLabel}
          </span>
        </div>
      )}

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main">
        <ul role="list" className="px-2 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-forest-light text-forest"
                      : "text-ink-secondary hover:bg-offwhite hover:text-ink"
                  )}
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom nav */}
      <div className="border-t border-border py-3">
        <ul role="list" className="px-2 space-y-0.5">
          {bottomNavItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-forest-light text-forest"
                      : "text-ink-secondary hover:bg-offwhite hover:text-ink"
                  )}
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}

          {/* Sign out */}
          <li>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-ink-secondary hover:bg-offwhite hover:text-ink transition-colors"
              >
                <LogOut size={18} aria-hidden="true" />
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </div>
    </aside>
  );
}
