/**
 * Unit & Integration Tests for Overview Page (Dashboard).
 *
 * Verifies:
 * - Real draft counts (exact numbers, never '—')
 * - Truthful empty states (0 drafts, 0 activity)
 * - First-draft action callout when workspace has 0 posts
 * - Graceful database error handling without masking failures as 0
 * - Real agent state rendering (active_approval_required, paused)
 * - Draft-only preview restrictions banner
 * - Tenant isolation (queries scoped strictly by workspace_id)
 * - Setup required redirect to /app/onboarding
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OverviewPage from "./page";
import { redirect } from "next/navigation";
import type { Workspace } from "@/types/database";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/workspace", () => ({
  requireWorkspace: vi.fn(),
  AuthError: class AuthError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("OverviewPage (Dashboard)", () => {
  const baseWorkspace: Workspace = {
    id: "ws-dash-test",
    owner_user_id: "user-dash-test",
    name: "Founder Ventures",
    state: "active_approval_required",
    entitlement_type: "draft_only",
    operating_mode: "approval_required",
    paused_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /app/onboarding when workspace state is setup_required", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    vi.mocked(requireWorkspace).mockResolvedValue({
      ...baseWorkspace,
      state: "setup_required",
    });

    await OverviewPage();
    expect(redirect).toHaveBeenCalledWith("/app/onboarding");
  });

  it("renders truthful zero counts and first-draft callout when no drafts exist", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue(baseWorkspace);

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "content_posts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                expect(col).toBe("workspace_id");
                expect(val).toBe("ws-dash-test"); // Tenant isolation check
                return {
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
                    then: (resolve: any) => resolve({ count: 0, error: null }),
                  }),
                  eq: vi.fn().mockImplementation(() => ({
                    then: (resolve: (value: { count: number | null; error: null }) => void) => resolve({ count: 0, error: null }),
                    not: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  })),
                  then: (resolve: any) => resolve({ count: 0, error: null }),
                };
              }),
            }),
          };
        }
        if (table === "audit_events" || table === "agent_jobs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const jsx = await OverviewPage();
    const rendered = renderToStaticMarkup(jsx);

    // Draft count should be 0, not "—"
    expect(rendered).toContain(">0<");
    expect(rendered).toContain("Ready for your first draft?");
    expect(rendered).toContain("Create First Draft");
    expect(rendered).toContain("Start Your Free Trial");
  });

  it("renders real counts when drafts exist", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue(baseWorkspace);

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "content_posts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                expect(col).toBe("workspace_id");
                expect(val).toBe("ws-dash-test"); // Tenant isolation check
                return {
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
                    then: (resolve: any) => resolve({ count: 4, error: null }),
                  }),
                  eq: vi.fn().mockImplementation(() => ({
                    then: (resolve: (value: { count: number | null; error: null }) => void) => resolve({ count: 2, error: null }),
                    not: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  })),
                  then: (resolve: any) => resolve({ count: 6, error: null }),
                };
              }),
            }),
          };
        }
        if (table === "audit_events" || table === "agent_jobs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const jsx = await OverviewPage();
    const rendered = renderToStaticMarkup(jsx);

    expect(rendered).toContain("Needs Review");
    expect(rendered).toContain(">4<");
    expect(rendered).toContain("2 approved");
    expect(rendered).not.toContain("Ready for your first draft?");
  });

  it("handles database query failures explicitly without masking as zero", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue(baseWorkspace);

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "content_posts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
                  then: (resolve: any) => resolve({ count: null, error: { message: "Database connection timeout" } }),
                }),
                eq: vi.fn().mockImplementation(() => ({
                    then: (resolve: (value: { count: number | null; error: null }) => void) => resolve({ count: null, error: null }),
                    not: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  })),
                then: (resolve: any) => resolve({ count: null, error: null }),
              }),
            }),
          };
        }
        if (table === "audit_events" || table === "agent_jobs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const jsx = await OverviewPage();
    const rendered = renderToStaticMarkup(jsx);

    expect(rendered).toContain("—");
    expect(rendered).not.toContain("0 drafts currently waiting for review.");
  });

  it("correctly displays paused state when workspace is paused", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue({
      ...baseWorkspace,
      state: "paused",
      paused_at: new Date().toISOString(),
    });

    const mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
                    then: (resolve: any) => resolve({ count: 0, error: null }),
                  }),
            eq: vi.fn().mockImplementation(() => ({
                    then: (resolve: (value: { count: number | null; error: null }) => void) => resolve({ count: 0, error: null }),
                    not: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  })),
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            then: (resolve: any) => resolve({ count: 0, error: null }),
          }),
        }),
      })),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const jsx = await OverviewPage();
    const rendered = renderToStaticMarkup(jsx);

    expect(rendered).toContain("Paused");
    expect(rendered).toContain("All background jobs and publishing are halted.");
  });

  it("renders Private Beta badge and active notice for provisioned beta workspaces", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue({
      ...baseWorkspace,
      entitlement_type: "internal_beta",
    });

    const mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
                    then: (resolve: any) => resolve({ count: 1, error: null }),
                  }),
            eq: vi.fn().mockImplementation(() => ({
                    then: (resolve: (value: { count: number | null; error: null }) => void) => resolve({ count: 1, error: null }),
                    not: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  })),
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            then: (resolve: any) => resolve({ count: 2, error: null }),
          }),
        }),
      })),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const jsx = await OverviewPage();
    const rendered = renderToStaticMarkup(jsx);

    expect(rendered).toContain("Private Beta");
    expect(rendered).toContain("Full v1.0.0 access");
    expect(rendered).not.toContain("Start Your Free Trial");
  });
});
