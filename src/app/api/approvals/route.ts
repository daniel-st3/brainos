import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { readControl } from "@/control/service";
import { createCandidate, isReview } from "@/approval/service";
import { approvalRuntimeReady, wakeApproval } from "@/approval/runtime";
import { dataMode } from "@/server/mode";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await editor();
    const state = await readControl(
      await applicationRpc(),
      dataMode() === "demo",
    );
    return NextResponse.json(
      {
        reviews: state.entities
          .filter(isReview)
          .map((e) => ({
            id: e.id,
            state: e.data.state,
            frozen: e.data.frozen,
            checksum: e.data.checksum,
          })),
        cloud: approvalRuntimeReady(),
        notification: "IN_APP_ONLY",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    await editor();
    const { packageId, scheduledAt } = z
      .object({
        packageId: z.string().uuid(),
        scheduledAt: z.iso.datetime().nullable().default(null),
      })
      .strict()
      .parse(await request.json());
    const rpc = await applicationRpc();
    const row = await createCandidate(
      rpc,
      packageId,
      scheduledAt,
      dataMode() === "demo",
    );
    return NextResponse.json({
      id: row.id,
      wake: await wakeApproval(rpc, row.id),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unable to prepare review";
    return NextResponse.json(
      {
        error:
          error === "Unauthorized"
            ? error
            : "Package not ready for cloud review. Check approvals, final media, account capability and schedule.",
      },
      { status: error === "Unauthorized" ? 401 : 422 },
    );
  }
}
