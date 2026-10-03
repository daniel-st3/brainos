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
import { approvalRuntimeReady, wakeApproval } from "@/approval/runtime";
import { processOutbox } from "@/providers/outbox";
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
        expired: Date.parse(row.data.expires_at) <= Date.now(),
        outbox_id: row.data.outbox_id,
        current,
        cloud: approvalRuntimeReady(),
        notification: "IN_APP_ONLY",
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
    const raw = JSON.parse(text),
      before = await findReview(rpc, id);
    if (
      raw.decision === "approve" &&
      !before.is_demo &&
      !approvalRuntimeReady()
    )
      throw Error("TRIGGER_RUNTIME_NOT_CONFIGURED");
    const row = await decideCandidate(rpc, id, raw, actor);
    // Safe hosted UI/receipt test without a Trigger account; never a live-send fallback.
    if (
      row.is_demo &&
      !approvalRuntimeReady() &&
      row.data.decision?.decision === "approve"
    ) {
      await resumeCandidate(rpc, id);
      await processOutbox(rpc, true);
      return NextResponse.json({
        saved: true,
        simulated: true,
        cloud_wait_verified: false,
      });
    }
    return NextResponse.json({
      saved: true,
      wake: await wakeApproval(rpc, id),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const known = [
      "Unauthorized",
      "STALE_CANDIDATE",
      "DECISION_ALREADY_RECORDED",
      "REVIEW_CLOSED",
      "SCHEDULE_PASSED_CREATE_NEW_CANDIDATE",
      "TRIGGER_RUNTIME_NOT_CONFIGURED",
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
