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
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Every dashboard destination, grouped. The desktop sidebar renders all of it. */
export const navSections: NavSection[] = [
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

/** The four destinations pinned to the phone tab bar. Everything else lives under "More". */
export const TAB_HREFS = [
  "/app/overview",
  "/app/content",
  "/app/calendar",
  "/app/activity",
] as const;

const allItems = navSections.flatMap((section) => section.items);

export const tabItems: NavItem[] = TAB_HREFS.map((href) => {
  const item = allItems.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`Tab ${href} is missing from navSections`);
  return item;
});

/** Sections shown in the "More" sheet: everything that is not a pinned tab. */
export const moreSections: NavSection[] = navSections
  .map((section) => ({
    ...section,
    items: section.items.filter((item) => !TAB_HREFS.includes(item.href as (typeof TAB_HREFS)[number])),
  }))
  .filter((section) => section.items.length > 0);

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Which tab is highlighted for a path: 0–3 for a pinned tab, 4 ("More") for any
 * other dashboard page, or -1 outside the dashboard navigation.
 */
export function getActiveTabIndex(pathname: string): number {
  const pinned = tabItems.findIndex((item) => isActivePath(pathname, item.href));
  if (pinned !== -1) return pinned;
  const inMore = moreSections.some((section) =>
    section.items.some((item) => isActivePath(pathname, item.href))
  );
  return inMore ? tabItems.length : -1;
}

export const ENTITLEMENT_LABELS: Record<string, { label: string; color: string }> = {
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
