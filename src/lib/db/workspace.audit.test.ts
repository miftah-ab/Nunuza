import { describe, expect, it, vi, beforeEach } from "vitest";
import { logAuditEvent } from "./workspace";
import { createClient, createServiceClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

describe("logAuditEvent", () => {
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    insert.mockResolvedValue({ error: null });
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    } as any);
  });

  it("writes server-authored audit records through the service-role client", async () => {
    await logAuditEvent({
      workspaceId: "workspace-1",
      actorType: "user",
      actorId: "user-1",
      action: "generate_draft",
      resourceType: "content_post",
      resourceId: "post-1",
      safeMetadata: { providerUsed: "groq" },
    });

    expect(createServiceClient).toHaveBeenCalledOnce();
    expect(createClient).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      workspace_id: "workspace-1",
      actor_type: "user",
      actor_id: "user-1",
      action: "generate_draft",
      resource_type: "content_post",
      resource_id: "post-1",
      safe_metadata: { providerUsed: "groq" },
    });
  });

  it("keeps the primary operation non-blocking when the service-role insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockResolvedValueOnce({ error: { message: "permission denied" } });

    await expect(logAuditEvent({
      workspaceId: "workspace-1",
      actorType: "system",
      action: "job_reconciled",
      resourceType: "agent_job",
    })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not fall back to the session client when service-role setup fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createServiceClient).mockImplementationOnce(() => {
      throw new Error("service role unavailable");
    });

    await expect(logAuditEvent({
      workspaceId: "workspace-1",
      actorType: "system",
      action: "job_reconciled",
      resourceType: "agent_job",
    })).resolves.toBeUndefined();

    expect(createClient).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
