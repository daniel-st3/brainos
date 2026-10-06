import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { controlSnapshot } from "@/control/service";
import {
  assertCurrent,
  decideCandidate,
  findReview,
  resumeCandidate,
} from "@/approval/service";
import { importedPublicationBlockers } from "@/approval/imported";
import { notificationStatus } from "@/approval/notifications";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await editor();
    const rpc = await applicationRpc(),
      row = await findReview(rpc, (await context.params).id);
    let current = true;
    try {
      assertCurrent(await controlSnapshot(rpc, row.is_demo), row);
    } catch {
      current = false;
    }
    return NextResponse.json(
      {
        id: row.id,
        version: row.version,
        demo: row.is_demo,
        checksum: row.data.checksum,
        frozen: row.data.frozen,
        state: row.data.state,
        decision: row.data.decision,
        expires_at: row.data.expires_at,
        expired:
          !!row.data.expires_at &&
          Date.parse(row.data.expires_at) <= Date.now(),
        outbox_id: row.data.outbox_id,
        current,
        blockers: row.data.frozen.imported
          ? importedPublicationBlockers(
              row.data.frozen.imported,
              row.data.frozen.adapter,
            )
          : [],
        cloud: process.env.CONTENT_OS_MODE === "supabase",
        notification: await notificationStatus(rpc),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Review unavailable" },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 404,
      },
    );
  }
}
export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const actor = await editor(),
      rpc = await applicationRpc(),
      id = (await context.params).id;
    const text = await request.text();
    if (text.length > 10000) throw Error("REQUEST_TOO_LARGE");
    const row = await decideCandidate(rpc, id, JSON.parse(text), actor);
    // A durable outbox row is the success boundary. Cron owns all dispatch.
    const result =
      row.data.decision?.decision === "approve"
        ? await resumeCandidate(rpc, id)
        : { state: row.data.state, outbox_id: null };
    return NextResponse.json({
      saved: true,
      simulated: row.is_demo,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const known = [
      "Unauthorized",
      "STALE_CANDIDATE",
      "DECISION_ALREADY_RECORDED",
      "REVIEW_CLOSED",
      "SCHEDULE_PASSED_CREATE_NEW_CANDIDATE",
    ];
    return NextResponse.json(
      {
        error: known.includes(message)
          ? message
          : "Decision could not be completed. Refresh to check whether it was saved; retry is safe.",
      },
      { status: message === "Unauthorized" ? 401 : 409 },
    );
  }
}
