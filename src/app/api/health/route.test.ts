import { describe, expect, it, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ from }) }));

import { GET } from "./route";

describe("GET /api/health", () => {
  it("reuses a recent result instead of querying the database on every hit", async () => {
    from.mockImplementation(() => {
      const chain: any = {};
      chain.select = () => chain;
      chain.limit = async () => ({ error: null });
      chain.eq = () => chain;
      chain.lt = async () => ({ error: null, count: 0 });
      return chain;
    });
    const first = await GET();
    const callsAfterFirst = from.mock.calls.length;
    const second = await GET();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(from.mock.calls.length).toBe(callsAfterFirst);
  });
});
