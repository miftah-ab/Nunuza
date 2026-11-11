import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { AuthError, requireWorkspace } from "@/lib/auth/workspace";
import { logAuditEvent, upsertVoiceProfile } from "@/lib/db/workspace";
import type { Workspace, VoiceProfile } from "@/types/database";

vi.mock("@/lib/auth/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/workspace")>();
  return { ...actual, requireWorkspace: vi.fn() };
});

vi.mock("@/lib/db/workspace", () => ({
  upsertVoiceProfile: vi.fn(),
  logAuditEvent: vi.fn(),
}));

const workspace: Workspace = {
  id: "workspace-voice-1",
  owner_user_id: "user-voice-1",
  name: "Voice Workspace",
  state: "active_approval_required",
  entitlement_type: "draft_only",
  operating_mode: "approval_required",
  paused_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const savedProfile: VoiceProfile = {
  id: "voice-profile-1",
  workspace_id: workspace.id,
  tone: "Direct",
  sentence_length: "Short",
  formality: "Conversational",
  phrases_use: ["real talk"],
  phrases_avoid: ["synergy"],
  sample_text: "A writing sample.",
  exclusions: ["politics"],
  version: 2,
  updated_at: "2026-11-11T00:00:00.000Z",
};

describe("PATCH /api/voice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the authenticated workspace voice profile and audits the version", async () => {
    vi.mocked(requireWorkspace).mockResolvedValue(workspace);
    vi.mocked(upsertVoiceProfile).mockResolvedValue(savedProfile);

    const request = new Request("http://localhost:3000/api/voice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tone: "Direct",
        sentence_length: "Short",
        formality: "Conversational",
        phrases_use: ["real talk"],
        phrases_avoid: ["synergy"],
        sample_text: "A writing sample.",
        exclusions: ["politics"],
      }),
    });

    const response = await PATCH(request);
    const json = await response.json() as { data: VoiceProfile };

    expect(response.status).toBe(200);
    expect(json.data.version).toBe(2);
    expect(upsertVoiceProfile).toHaveBeenCalledWith(workspace.id, expect.objectContaining({
      tone: "Direct",
      phrases_avoid: ["synergy"],
      exclusions: ["politics"],
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: workspace.id,
      action: "update_voice_profile",
      safeMetadata: { version: 2 },
    }));
  });

  it("rejects oversized phrase lists before writing", async () => {
    vi.mocked(requireWorkspace).mockResolvedValue(workspace);
    const request = new Request("http://localhost:3000/api/voice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrases_avoid: Array.from({ length: 31 }, (_, index) => "phrase " + index) }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    expect(upsertVoiceProfile).not.toHaveBeenCalled();
  });

  it("returns an authentication error for unauthenticated requests", async () => {
    vi.mocked(requireWorkspace).mockRejectedValue(new AuthError());
    const request = new Request("http://localhost:3000/api/voice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone: "Direct" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(401);
    expect(upsertVoiceProfile).not.toHaveBeenCalled();
  });
});
