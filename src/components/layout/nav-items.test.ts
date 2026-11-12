import { describe, it, expect } from "vitest";
import { getActiveTabIndex, isActivePath, moreSections, navSections, tabItems } from "./nav-items";

describe("phone tab bar navigation", () => {
  it("pins four tabs and every other destination appears under More", () => {
    expect(tabItems.map((t) => t.label)).toEqual(["Overview", "Content", "Calendar", "Activity"]);
    const total = navSections.reduce((n, s) => n + s.items.length, 0);
    const more = moreSections.reduce((n, s) => n + s.items.length, 0);
    expect(more).toBe(total - tabItems.length);
  });

  it("never lists a destination both as a tab and under More", () => {
    const tabHrefs = new Set(tabItems.map((t) => t.href));
    for (const section of moreSections) {
      for (const item of section.items) expect(tabHrefs.has(item.href)).toBe(false);
    }
  });

  it("highlights the matching tab, including nested routes", () => {
    expect(getActiveTabIndex("/app/overview")).toBe(0);
    expect(getActiveTabIndex("/app/content")).toBe(1);
    expect(getActiveTabIndex("/app/content/abc-123")).toBe(1);
    expect(getActiveTabIndex("/app/calendar")).toBe(2);
    expect(getActiveTabIndex("/app/activity")).toBe(3);
  });

  it("highlights More for pages that live in the sheet", () => {
    for (const path of ["/app/voice", "/app/strategy", "/app/permissions", "/app/performance", "/app/engagement", "/app/integrations", "/app/settings", "/app/billing"]) {
      expect(getActiveTabIndex(path)).toBe(4);
    }
  });

  it("highlights nothing outside dashboard navigation", () => {
    expect(getActiveTabIndex("/app/onboarding")).toBe(-1);
    expect(getActiveTabIndex("/login")).toBe(-1);
  });

  it("does not treat a path that merely shares a prefix as active", () => {
    expect(isActivePath("/app/contentious", "/app/content")).toBe(false);
  });
});
