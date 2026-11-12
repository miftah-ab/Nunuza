import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OverviewPage from "./page";
import { redirect } from "next/navigation";
import type { Workspace } from "@/types/database";

const mocks = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  createClient: vi.fn(),
  telegram: vi.fn(),
  mcp: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error("REDIRECT:" + path); }) }));
vi.mock("@/lib/auth/workspace", () => ({
  requireWorkspace: mocks.requireWorkspace,
  AuthError: class AuthError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/integrations/telegram/service", () => ({ getTelegramLinkStatus: mocks.telegram }));
vi.mock("@/lib/integrations/mcp/tokens", () => ({ getMcpCredentialStatus: mocks.mcp }));

const workspace: Workspace = {
  id: "ws-overview-test",
  owner_user_id: "user-overview-test",
  name: "Test workspace",
  state: "active_approval_required",
  entitlement_type: "draft_only",
  operating_mode: "approval_required",
  paused_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function makeSupabase(options: { failPosts?: boolean } = {}) {
  const queriedWorkspaceIds: string[] = [];
  const supabase = {
    from: vi.fn((table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push([column, value]);
          if (column === "workspace_id") queriedWorkspaceIds.push(String(value));
          return builder;
        }),
        in: vi.fn(() => builder),
        not: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => {
          if (table === "integration_connections") {
            return { data: { status: "connected", expires_at: "2099-01-01T00:00:00.000Z", metadata: { name: "Test LinkedIn" } }, error: null };
          }
          if (table === "content_strategies") {
            return { data: { cadence_per_week: 3, timezone: "UTC" }, error: null };
          }
          return { data: null, error: null };
        }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          if (options.failPosts && table === "content_posts") {
            return Promise.resolve({ data: null, count: null, error: { message: "database unavailable" } }).then(resolve, reject);
          }
          let count = 0;
          if (table === "content_posts") {
            const status = filters.find(([column]) => column === "status")?.[1];
            const statuses = filters.find(([column]) => column === "status-list")?.[1];
            if (status === "approved") count = 1;
            else if (status === "scheduled") count = 3;
            else if (status === "published") count = 5;
            else if (Array.isArray(statuses) && statuses.length === 2) count = 2;
            else if (Array.isArray(statuses)) count = 6;
          }
          return Promise.resolve({ data: [], count, error: null }).then(resolve, reject);
        },
      };
      // Supabase uses .in("status", values); retain the values for realistic count assertions.
      builder.in = vi.fn((column: string, value: unknown) => {
        filters.push([column === "status" ? "status-list" : column, value]);
        return builder;
      });
      return builder;
    }),
  };
  return { supabase, queriedWorkspaceIds };
}

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue(workspace);
    mocks.telegram.mockResolvedValue({ linked: false });
    mocks.mcp.mockResolvedValue({ active: false });
  });

  it("redirects setup-required workspaces before querying data", async () => {
    mocks.requireWorkspace.mockResolvedValue({ ...workspace, state: "setup_required" });
    await expect(OverviewPage()).rejects.toThrow("REDIRECT:/app/onboarding");
    expect(redirect).toHaveBeenCalledWith("/app/onboarding");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("renders truthful counts and empty states using workspace-scoped queries", async () => {
    const { supabase, queriedWorkspaceIds } = makeSupabase();
    mocks.createClient.mockResolvedValue(supabase);
    const html = renderToStaticMarkup(await OverviewPage());

    expect(html).toContain("Overview");
    expect(html).toContain("Needs Review");
    expect(html).toContain(">2<");
    expect(html).toContain("1 approved");
    expect(html).toContain("No upcoming publications");
    expect(html).toContain("No drafts awaiting review");
    expect(html).toContain("Test LinkedIn");
    expect(queriedWorkspaceIds.length).toBeGreaterThan(0);
    expect(queriedWorkspaceIds.every((id) => id === workspace.id)).toBe(true);
  });

  it("does not present failed post metrics as zero", async () => {
    const { supabase } = makeSupabase({ failPosts: true });
    mocks.createClient.mockResolvedValue(supabase);
    const html = renderToStaticMarkup(await OverviewPage());

    expect(html).toContain("Some numbers are temporarily unavailable");
    expect(html).toContain(">—<");
  });

  it("shows paused state when the workspace has a pause timestamp", async () => {
    const { supabase } = makeSupabase();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.requireWorkspace.mockResolvedValue({ ...workspace, paused_at: "2026-11-11T00:00:00.000Z" });
    const html = renderToStaticMarkup(await OverviewPage());

    expect(html).toContain("Paused");
    expect(html).toContain("The workspace is paused");
  });

  it("shows the private beta entitlement without claiming unsupported capabilities", async () => {
    const { supabase } = makeSupabase();
    mocks.createClient.mockResolvedValue(supabase);
    mocks.requireWorkspace.mockResolvedValue({ ...workspace, entitlement_type: "internal_beta" });
    const html = renderToStaticMarkup(await OverviewPage());

    expect(html).toContain("Private Beta");
    expect(html).toContain("Your workspace has private-beta access");
    expect(html).not.toContain("Full v1.0.0 access");
  });
});
