/**
 * MCP Credential Management API.
 *
 * GET    /api/integrations/mcp - Get active credential status
 * POST   /api/integrations/mcp - Generate / rotate MCP token (returns raw token once)
 * DELETE /api/integrations/mcp - Revoke active MCP credential
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import {
  generateMcpToken,
  getMcpCredentialStatus,
  revokeMcpToken,
} from "@/lib/integrations/mcp/tokens";

function mcpDisabledResponse() {
  return NextResponse.json(
    { error: "The Nunuza MCP integration is not enabled." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  if (process.env.MCP_ENABLED !== "true") return mcpDisabledResponse();

  try {
    const workspace = await requireWorkspace();
    const status = await getMcpCredentialStatus(workspace.id);
    return ok({ status });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  if (process.env.MCP_ENABLED !== "true") return mcpDisabledResponse();

  try {
    const userId = await requireAuth();
    const workspace = await requireWorkspace();
    const body = await parseBody<{ scopes?: unknown }>(req);
    const scopes = body?.scopes === undefined ? ["read", "write"] : body.scopes;
    const validScopes = Array.isArray(scopes)
      && scopes.length > 0
      && scopes.every((scope) => scope === "read" || scope === "write")
      && new Set(scopes).size === scopes.length;

    if (!validScopes) {
      return NextResponse.json({ error: "Scopes must be a non-empty list containing only unique read/write values." }, { status: 400 });
    }

    const result = await generateMcpToken(workspace.id, userId, scopes as string[]);

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
  if (process.env.MCP_ENABLED !== "true") return mcpDisabledResponse();

  try {
    const userId = await requireAuth();
    const workspace = await requireWorkspace();
    const success = await revokeMcpToken(workspace.id, userId);

    return ok({ success });
  } catch (err) {
    return apiError(err);
  }
}
