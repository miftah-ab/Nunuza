import {
  McpServer,
  OAuthError,
  OAuthErrorCode,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { NextRequest } from "next/server";
import {
  MCP_TOOLS,
  executeMcpTool,
  getMcpToolsForScopes,
  type McpToolDefinition,
} from "@/lib/integrations/mcp/tools";
import {
  verifyMcpOAuthToken,
  verifyMcpToken,
  type McpTokenRecord,
} from "@/lib/integrations/mcp/tokens";

export const runtime = "nodejs";

type NunuzaAuthInfo = AuthInfo & {
  workspaceId: string;
  userId: string;
};

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    const credential: McpTokenRecord | null = token.startsWith("nunuza_mcp_")
      ? await verifyMcpToken(token)
      : await verifyMcpOAuthToken(token);

    if (!credential) {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "The Nunuza access token is invalid, expired, or revoked."
      );
    }

    return {
      token,
      clientId: credential.id,
      scopes: credential.scopes,
      // Legacy workspace keys have no expiry; they are checked against the
      // credential table on every request and can be revoked immediately.
      expiresAt: credential.expiresAt ?? 253402300799,
      workspaceId: credential.workspaceId,
      userId: credential.userId,
    } as NunuzaAuthInfo;
  },
};

function toZodInputSchema(tool: McpToolDefinition) {
  const shape: Record<string, any> = {};
  const required = new Set(tool.inputSchema.required || []);

  for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
    let field: any =
      property.type === "number" ? z.number().finite() : z.string();

    if (Array.isArray(property.enum) && property.enum.length > 0) {
      field = z.enum(property.enum as [string, ...string[]]);
    }

    if (!required.has(name)) field = field.optional();
    shape[name] = field;
  }

  return z.object(shape).strict();
}

function buildServer(context: { authInfo?: AuthInfo }) {
  const authInfo = context.authInfo as NunuzaAuthInfo | undefined;
  if (!authInfo?.workspaceId || !authInfo.userId) {
    throw new Error("Authenticated Nunuza workspace context is missing.");
  }

  const server = new McpServer({
    name: "nunuza-remote-mcp",
    version: "1.0.0",
  });

  const allowedTools = getMcpToolsForScopes(authInfo.scopes);
  for (const tool of allowedTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: toZodInputSchema(tool),
      },
      async (args) => {
        try {
          const result = await executeMcpTool(
            tool.name,
            args as Record<string, any>,
            {
              workspaceId: authInfo.workspaceId,
              userId: authInfo.userId,
              scopes: authInfo.scopes,
            }
          );

          return {
            content: [{
              type: "text" as const,
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: error instanceof Error ? error.message : "Tool execution failed.",
            }],
          };
        }
      }
    );
  }

  // Fail closed if a future tool registry change accidentally exposes approvals.
  if (MCP_TOOLS.some((tool) => tool.name === "approve_draft")) {
    throw new Error("CRITICAL SECURITY VIOLATION: approve_draft must never be registered.");
  }

  return server;
}

const mcpHandler = createMcpHandler(buildServer);

async function handleMcpRequest(request: NextRequest): Promise<Response> {
  if (process.env.MCP_ENABLED !== "true") {
    return Response.json(
      { error: "The Nunuza MCP integration is not enabled." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const resourceUrl = new URL(process.env.MCP_RESOURCE_URL || "/api/mcp", appUrl);
  const gate = requireBearerAuth({
    verifier,
    expectedResource: resourceUrl,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  const authInfo = await gate(request);
  if (authInfo instanceof Response) return authInfo;

  return mcpHandler.fetch(request, { authInfo });
}

export async function POST(request: NextRequest) {
  return handleMcpRequest(request);
}

export async function GET(request: NextRequest) {
  return handleMcpRequest(request);
}

export async function DELETE(request: NextRequest) {
  return handleMcpRequest(request);
}
