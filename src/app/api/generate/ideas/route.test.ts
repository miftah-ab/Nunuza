import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({ requireWorkspace: vi.fn(async () => ({ id: "w1", name: "Acme", owner_user_id: "u1" })) }));
vi.mock("@/lib/db/usage", () => ({ consumeIdeasAllowance: vi.fn() }));
vi.mock("@/lib/ai/service", () => ({ aiService: { generatePlan: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/db/workspace", () => ({ getContentStrategy: vi.fn(), getVoiceProfile: vi.fn() }));
vi.mock("@/lib/db/posts", () => ({ listPosts: vi.fn() }));

import { POST } from "./route";
import { consumeIdeasAllowance } from "@/lib/db/usage";
import { aiService } from "@/lib/ai/service";

describe("POST /api/generate/ideas rate limit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 429 and never calls the AI once the hourly allowance is used", async () => {
    vi.mocked(consumeIdeasAllowance).mockResolvedValueOnce(false);
    const res = await POST();
    expect(res.status).toBe(429);
    expect(aiService.generatePlan).not.toHaveBeenCalled();
  });
});
