/**
 * Remote Model Context Protocol (MCP) HTTP Endpoint.
 *
 * Endpoint: POST /api/mcp
 *
 * Transport: JSON-RPC 2.0 over HTTP (Streamable / Request-Response).
 * Authentication: Authorization: Bearer <nunuza_mcp_...>
 *
 * Conforms to Model Context Protocol specification:
 * - initialize
 * - tools/list
 * - tools/call
 * - ping
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMcpToken } from "@/lib/integrations/mcp/tokens";
import { MCP_TOOLS, executeMcpTool } from "@/lib/integrations/mcp/tools";

function jsonRpcError(id: any, code: number, message: string, data?: any, status = 200) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code,
        message,
        ...(data ? { data } : {}),
      },
    },
    { status }
  );
}

function jsonRpcSuccess(id: any, result: any) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  });
}

export async function POST(req: NextRequest) {
  // 1. Authenticate Bearer Token
  const authHeader = req.headers.get("authorization") || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(nunuza_mcp_[a-zA-Z0-9_-]+)$/i);

  if (!tokenMatch) {
    return jsonRpcError(
      null,
      -32001,
      "Unauthorized: Missing or malformed MCP Bearer token. Use 'Authorization: Bearer nunuza_mcp_...'",
      undefined,
      401
    );
  }

  const rawToken = tokenMatch[1];
  const credential = await verifyMcpToken(rawToken);

  if (!credential) {
    return jsonRpcError(
      null,
      -32001,
      "Unauthorized: Invalid, expired, or revoked MCP token.",
      undefined,
      401
    );
  }

  // 2. Parse JSON-RPC Payload
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error: Invalid JSON");
  }

  const { jsonrpc, id, method, params } = body || {};

  if (jsonrpc !== "2.0" || !method) {
    return jsonRpcError(id, -32600, "Invalid Request: Expected JSON-RPC 2.0 request with 'method'");
  }

  // 3. Dispatch Methods
  try {
    switch (method) {
      case "initialize": {
        return jsonRpcSuccess(id, {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "nunuza-remote-mcp",
            version: "1.0.0",
          },
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
        });
      }

      case "ping": {
        return jsonRpcSuccess(id, {});
      }

      case "tools/list": {
        // Return tools (approve_draft is strictly absent)
        return jsonRpcSuccess(id, {
          tools: MCP_TOOLS,
        });
      }

      case "tools/call": {
        const { name, arguments: toolArgs } = params || {};
        if (!name) {
          return jsonRpcError(id, -32602, "Invalid params: 'name' is required for tools/call");
        }

        // Explicit check against forbidden approve_draft
        if (name === "approve_draft") {
          return jsonRpcError(
            id,
            -32601,
            "Method prohibited: approve_draft is not permitted via MCP. Approvals require human action via web UI or Telegram."
          );
        }

        const toolResult = await executeMcpTool(name, toolArgs || {}, {
          workspaceId: credential.workspaceId,
          userId: credential.userId,
          scopes: credential.scopes,
        });

        return jsonRpcSuccess(id, {
          content: [
            {
              type: "text",
              text: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2),
            },
          ],
        });
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err: any) {
    console.error(`[mcp] Error in method "${method}":`, err);
    return jsonRpcError(id, -32000, err.message || "Internal server error");
  }
}
