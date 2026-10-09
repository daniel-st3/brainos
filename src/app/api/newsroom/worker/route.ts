import { NextResponse } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/production/worker-auth";
import { applicationRpc } from "@/ingestion/store";
import { storageClient } from "@/integrations/media";
import { completeNewsroom } from "@/newsroom/complete";
import type { Job } from "@/control/model";
export const maxDuration = 120;
export async function POST(request: Request) {
  if (!workerAuthorized(request.headers.get("x-brainos-worker-token")))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.BRAINOS_AUTONOMOUS_STAGING !== "true")
    return NextResponse.json(
      { error: "NEWSROOM_STAGING_DISABLED" },
      { status: 409 },
    );
  try {
    const text = await request.text();
    if (text.length > 200000) throw Error("REQUEST_TOO_LARGE");
    const raw = JSON.parse(text),
      rpc = await applicationRpc();
    if (raw.action === "claim")
      return NextResponse.json(
        { job: await rpc("claim_newsroom_job") },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const id = z.uuid().parse(raw.job_id),
      token = z.uuid().parse(raw.lease_token),
      job = (await rpc("newsroom_job", {
        p_id: id,
        p_token: token,
        p_heartbeat: raw.action === "heartbeat",
      })) as Job;
    if (raw.action === "heartbeat") return NextResponse.json({ ok: true });
    if (raw.action === "fail") {
      await rpc("finish_control_job", {
        p_id: id,
        p_token: token,
        p_status: "blocked",
        p_result: raw.metrics ?? {},
        p_error: z
          .enum([
            "PRIMARY_SOURCES_UNAVAILABLE",
            "NO_AUTHENTIC_HIGH_RESOLUTION_MEDIA",
            "CREATIVE_QA_REJECTED",
            "EDITORIAL_QA_FAILED",
            "EXECUTION_FAILED",
          ])
          .parse(raw.error),
        p_retryable: true,
      });
      return NextResponse.json({ ok: true });
    }
    if (raw.action === "upload") {
      const name = z
          .string()
          .regex(/^0[1-6]\.(png|jpg|mp4)$/)
          .parse(raw.name),
        sha = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(raw.sha256);
      z.number().int().positive().max(30000000).parse(raw.bytes);
      const file_id = `${job.input.package_id}/external/${sha}/${name}`,
        r = await storageClient()
          .storage.from("brainos-production")
          .createSignedUploadUrl(file_id);
      if (r.error || !r.data) throw Error("UPLOAD_TICKET_FAILED");
      return NextResponse.json(
        { file_id, url: r.data.signedUrl },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (raw.action === "complete")
      return NextResponse.json(await completeNewsroom(rpc, job, raw.result));
    throw Error("UNKNOWN_ACTION");
  } catch {
    return NextResponse.json(
      { error: "Newsroom job request failed; no publication authorized" },
      { status: 409 },
    );
  }
}
