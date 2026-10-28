/**
 * GET  /api/plans — list content plans for authenticated workspace
 * POST /api/plans — generate a new strategic content plan
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { generateAndSavePlan, listContentPlans } from "@/lib/plans/service";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const plans = await listContentPlans(workspace.id);
    return ok({ plans });
  } catch (err) {
    return apiError(err);
  }
}

interface GeneratePlanBody {
  periodDays?: number;
  startDate?: string;
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = (await parseBody<GeneratePlanBody>(request)) ?? {};

    const plan = await generateAndSavePlan(
      workspace.id,
      workspace.owner_user_id,
      {
        periodDays: body.periodDays,
        startDate: body.startDate,
      }
    );

    return ok({ plan }, 201);
  } catch (err) {
    return apiError(err);
  }
}
