"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, MoreHorizontal, X } from "lucide-react";
import {
  ENTITLEMENT_LABELS,
  getActiveTabIndex,
  isActivePath,
  moreSections,
  tabItems,
} from "@/components/layout/nav-items";
import type { Workspace } from "@/types/database";
import "./mobile-tab-bar.css";

interface MobileTabBarProps {
  workspace: Workspace | null;
}

/**
 * Phone-only floating tab bar for the dashboard (hidden from the md breakpoint up,
 * where the sidebar takes over). Four pinned tabs plus "More", which opens a sheet
 * with every other destination and sign out.
 */
export function MobileTabBar({ workspace }: MobileTabBarProps) {
  const pathname = usePathname();
  // Remember which page the sheet was opened on: navigating anywhere closes it
  // without needing an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const sheetOpen = openOn === pathname;
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const activeIndex = getActiveTabIndex(pathname);
  const moreIndex = tabItems.length;
  const entitlement = workspace
    ? (ENTITLEMENT_LABELS[workspace.entitlement_type]?.label ?? workspace.entitlement_type)
    : null;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [sheetOpen]);

  return (
    <>
      <nav className="nzm-bar" aria-label="Primary">
        <span
          className="nzm-pill"
          aria-hidden="true"
          style={{ "--i": Math.max(activeIndex, 0), opacity: activeIndex === -1 ? 0 : 1 } as React.CSSProperties}
        />
        {tabItems.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className="nzm-item"
              aria-current={active ? "page" : undefined}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`nzm-item${activeIndex === moreIndex ? " is-active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setOpenOn(pathname)}
        >
          <MoreHorizontal size={22} strokeWidth={activeIndex === moreIndex ? 2.4 : 2} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {sheetOpen && (
        <div className="nzm-layer" role="dialog" aria-modal="true" aria-label="More pages">
          <button
            type="button"
            className="nzm-scrim"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpenOn(null)}
          />
          <div className="nzm-sheet">
            <div className="nzm-grabber" aria-hidden="true" />
            <div className="nzm-sheet-head">
              <div>
                <p className="nzm-ws">{workspace?.name ?? "Your workspace"}</p>
                {entitlement && <span className="nzm-badge">{entitlement}</span>}
              </div>
              <button
                ref={closeRef}
                type="button"
                className="nzm-close"
                aria-label="Close menu"
                onClick={() => setOpenOn(null)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {moreSections.map((section) => (
              <section key={section.title} className="nzm-group">
                <h2>{section.title}</h2>
                <ul role="list" className="nzm-grid">
                  {section.items.map(({ href, label, icon: Icon }) => {
                    const active = isActivePath(pathname, href);
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          className={`nzm-tile${active ? " is-active" : ""}`}
                          aria-current={active ? "page" : undefined}
                        >
                          <span className="nzm-tile-icon">
                            <Icon size={22} aria-hidden="true" />
                          </span>
                          <span className="nzm-tile-label">{label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <form action="/auth/signout" method="POST" className="nzm-signout">
              <button type="submit">
                <LogOut size={18} aria-hidden="true" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
