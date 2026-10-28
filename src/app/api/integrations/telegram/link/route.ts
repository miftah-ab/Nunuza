/**
 * Telegram Account Linking Management API.
 *
 * GET    /api/integrations/telegram/link - Get active link status
 * POST   /api/integrations/telegram/link - Generate a new one-time pairing token
 * DELETE /api/integrations/telegram/link - Revoke active Telegram link
 */

import { requireAuth, requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError } from "@/lib/api/respond";
import {
  generateTelegramPairingToken,
  getTelegramLinkStatus,
  unlinkTelegramAccount,
} from "@/lib/integrations/telegram/service";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const status = await getTelegramLinkStatus(workspace.id);
    return ok({ status });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST() {
  try {
    const userId = await requireAuth();
    const workspace = await requireWorkspace();
    const pairing = await generateTelegramPairingToken(workspace.id, userId);

    return ok({
      token: pairing.token,
      botUrl: pairing.botUrl,
      expiresAt: pairing.expiresAt,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE() {
  try {
    const workspace = await requireWorkspace();
    const success = await unlinkTelegramAccount(workspace.id);
    return ok({ success });
  } catch (err) {
    return apiError(err);
  }
}
