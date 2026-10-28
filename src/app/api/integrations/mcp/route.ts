/**
 * MCP Credential Management API.
 *
 * GET    /api/integrations/mcp - Get active credential status
 * POST   /api/integrations/mcp - Generate / rotate MCP token (returns raw token once)
 * DELETE /api/integrations/mcp - Revoke active MCP credential
 */

import { NextRequest } from "next/server";
import { requireAuth, requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import {
  generateMcpToken,
  getMcpCredentialStatus,
  revokeMcpToken,
} from "@/lib/integrations/mcp/tokens";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const status = await getMcpCredentialStatus(workspace.id);
    return ok({ status });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const workspace = await requireWorkspace();
    const body = await parseBody<{ scopes?: string[] }>(req);
    const scopes = Array.isArray(body?.scopes) ? body.scopes : ["read", "write"];

    const result = await generateMcpToken(workspace.id, userId, scopes);

    return ok({
      id: result.id,
      token: result.rawToken,
      createdAt: result.createdAt,
      note: "Copy this token now. It will not be shown again.",
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE() {
  try {
    const userId = await requireAuth();
    const workspace = await requireWorkspace();
    const success = await revokeMcpToken(workspace.id, userId);

    return ok({ success });
  } catch (err) {
    return apiError(err);
  }
}
