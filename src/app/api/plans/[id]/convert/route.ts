/**
 * POST /api/plans/[id]/convert — converts a planned topic item into a draft post
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { convertPlanItemToDraft } from "@/lib/plans/service";

interface ConvertBody {
  topic: string;
  pillar?: string;
  angle?: string;
  targetLength?: "short" | "medium" | "long";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspace = await requireWorkspace();
    const { id: planId } = await params;
    const body = await parseBody<ConvertBody>(request);

    if (!body || !body.topic) {
      return NextResponse.json(
        { error: "Topic is required to convert a plan item to a draft." },
        { status: 400 }
      );
    }

    const post = await convertPlanItemToDraft(
      workspace.id,
      workspace.owner_user_id,
      {
        planId,
        topic: body.topic,
        pillar: body.pillar,
        angle: body.angle,
        targetLength: body.targetLength,
      }
    );

    return ok({ post }, 201);
  } catch (err) {
    return apiError(err);
  }
}
