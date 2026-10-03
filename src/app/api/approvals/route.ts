import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { readControl } from "@/control/service";
import { createCandidate, isReview } from "@/approval/service";
import {
  deliverReviewNotifications,
  notificationStatus,
} from "@/approval/notifications";
import { dataMode } from "@/server/mode";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET() {
  try {
    await editor();
    const state = await readControl(
      await applicationRpc(),
      dataMode() === "demo",
    );
    return NextResponse.json(
      {
        reviews: state.entities.filter(isReview).map((e) => ({
          id: e.id,
          state: e.data.state,
          frozen: e.data.frozen,
          checksum: e.data.checksum,
        })),
        cloud: process.env.CONTENT_OS_MODE === "supabase",
        notification: await notificationStatus(await applicationRpc()),
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
    const { packageId, scheduledAt, staging } = z
      .object({
        packageId: z.string().uuid(),
        scheduledAt: z.iso.datetime().nullable().default(null),
        staging: z.boolean().default(false),
      })
      .strict()
      .parse(await request.json());
    const rpc = await applicationRpc();
    const row = await createCandidate(
      rpc,
      packageId,
      scheduledAt,
      dataMode() === "demo" || staging,
    );
    // Failure to notify must never lose the persisted review. Cron retries delivery.
    await deliverReviewNotifications(rpc, row.is_demo, fetch, row.id).catch(
      () => {},
    );
    return NextResponse.json({ id: row.id, state: row.data.state });
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
