import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError, ok, parseBody } from "@/lib/api/respond";
import { logAuditEvent, upsertVoiceProfile } from "@/lib/db/workspace";

class VoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceValidationError";
  }
}

type VoiceBody = {
  tone?: unknown;
  sentence_length?: unknown;
  formality?: unknown;
  phrases_use?: unknown;
  phrases_avoid?: unknown;
  sample_text?: unknown;
  exclusions?: unknown;
};

function cleanText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new VoiceValidationError("One or more Voice fields are invalid or too long.");
  }
  return value.trim();
}

function cleanList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 30) {
    throw new VoiceValidationError("Voice phrase and exclusion lists must contain no more than 30 entries.");
  }
  const items = value.map((item) => {
    if (typeof item !== "string" || item.trim().length > 120) {
      throw new VoiceValidationError("Each Voice phrase or exclusion must be text under 120 characters.");
    }
    return item.trim();
  }).filter(Boolean);
  return [...new Set(items)];
}

export async function PATCH(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<VoiceBody>(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A valid Voice profile is required." }, { status: 400 });
    }

    const input = {
      tone: cleanText(body.tone, 120),
      sentence_length: cleanText(body.sentence_length, 120),
      formality: cleanText(body.formality, 80),
      phrases_use: cleanList(body.phrases_use),
      phrases_avoid: cleanList(body.phrases_avoid),
      sample_text: cleanText(body.sample_text, 4000),
      exclusions: cleanList(body.exclusions),
    };

    const saved = await upsertVoiceProfile(workspace.id, input);
    await logAuditEvent({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: workspace.owner_user_id,
      action: "update_voice_profile",
      resourceType: "voice_profile",
      resourceId: saved.id,
      safeMetadata: { version: saved.version },
    });

    return ok(saved);
  } catch (error) {
    if (error instanceof VoiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
