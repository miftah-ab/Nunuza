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
import { getMcpToolsForScopes, executeMcpTool } from "@/lib/integrations/mcp/tools";

const MCP_PROTOCOL_VERSION = "2024-11-05";

function jsonRpcError(id: any, code: number, message: string, data?: any, status = 200) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data ? { data } : {}) },
    },
    { status, headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } }
  );
}

function jsonRpcSuccess(id: any, result: any) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    { headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } }
  );
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  const accept = req.headers.get("accept") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonRpcError(null, -32600, "Content-Type must be application/json.", undefined, 415);
  }
  if (!accept.toLowerCase().includes("application/json") || !accept.toLowerCase().includes("text/event-stream")) {
    return jsonRpcError(null, -32600, "Accept must include application/json and text/event-stream.", undefined, 406);
  }

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

  // Every post-initialize request, including notifications, carries the negotiated version.
  if (method !== "initialize" && req.headers.get("MCP-Protocol-Version") !== MCP_PROTOCOL_VERSION) {
    return jsonRpcError(id, -32600, "Missing or unsupported MCP-Protocol-Version.", undefined, 400);
  }

  // Notifications have no JSON-RPC id and must not receive a JSON-RPC response.
  if (typeof method === "string" && method.startsWith("notifications/") && id === undefined) {
    return new NextResponse(null, { status: 202 });
  }

  // 3. Dispatch Methods
  try {
    switch (method) {
      case "initialize": {
        return jsonRpcSuccess(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
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
          tools: getMcpToolsForScopes(credential.scopes),
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

        try {
          const toolResult = await executeMcpTool(name, toolArgs || {}, {
            workspaceId: credential.workspaceId,
            userId: credential.userId,
            scopes: credential.scopes,
          });
          return jsonRpcSuccess(id, {
            content: [{
              type: "text",
              text: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2),
            }],
          });
        } catch (toolError: any) {
          return jsonRpcSuccess(id, {
            isError: true,
            content: [{ type: "text", text: toolError?.message || "Tool execution failed." }],
          });
        }
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err: any) {
    console.error(`[mcp] Error in method "${method}":`, err);
    return jsonRpcError(id, -32000, err.message || "Internal server error");
  }
}


/** This endpoint is stateless and does not open server-sent event streams. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

/** Stateless sessions are not created, so there is no session to terminate. */
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
