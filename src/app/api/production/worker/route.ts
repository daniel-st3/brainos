import { workerIdentity, WORKER_PROTOCOL } from "@/production/protocol";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { applicationRpc } from "@/ingestion/store";
import { workerAuthorized } from "@/production/worker-auth";
import {
  currentPackage,
  finishTranscript,
  savePackage,
} from "@/production/service";
import { mediaSource, uploadTicket, storedInfo } from "@/production/storage";
import {
  assertMedia,
  renderSpec,
  renderOptionsSchema,
  digest,
  attachMedia,
} from "@/production/model";
import type { MediaJob } from "@/production/types";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!workerAuthorized(request.headers.get("x-brainos-worker-token")))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const raw = await request.json(),
      rpc = await applicationRpc();
    if (raw.action === "register") {
      const p = await currentPackage(rpc, z.uuid().parse(raw.package_id));
      if (raw.media?.provider !== "local")
        throw Error("Worker registration accepts local files only");
      return NextResponse.json(
        await savePackage(rpc, attachMedia(p, raw.media), "local-worker"),
      );
    }
    if (raw.action === "package")
      return NextResponse.json(
        await currentPackage(rpc, z.uuid().parse(raw.package_id)),
      );
    if (["claim", "heartbeat", "checkin"].includes(raw.action)) {
      const identity = workerIdentity(raw);
      await rpc("worker_checkin", {
        p_id: identity.id,
        p_protocol: WORKER_PROTOCOL,
        p_version: identity.version,
        p_capabilities: identity.capabilities,
        p_active:
          raw.action === "heartbeat" ? z.uuid().parse(raw.job_id) : null,
      });
      if (raw.action === "checkin")
        return NextResponse.json({ ok: true, protocol: WORKER_PROTOCOL });
    }
    if (raw.action === "claim") {
      const job = (await rpc("claim_production")) as MediaJob | null;
      if (!job) return NextResponse.json({ job: null });
      try {
        const p = await currentPackage(rpc, job.package_id);
        if (p.version !== job.package_version)
          throw Error("Production changed");
        const media = assertMedia(p, job.input.media_id);
        return NextResponse.json({
          job,
          package: p,
          source: await mediaSource(media),
          render:
            job.kind === "render" ? renderSpec(p, job.input.options!) : null,
        });
      } catch (e) {
        await rpc("fail_production", {
          p_job: job.id,
          p_token: job.lease_token,
          p_error: e instanceof Error ? e.message : "Media unavailable",
        });
        throw e;
      }
    }
    const input = z
      .object({ job_id: z.uuid(), lease_token: z.uuid() })
      .parse(raw);
    const job = (await rpc("get_production_job", {
      p_job: input.job_id,
      p_token: input.lease_token,
    })) as MediaJob | null;
    if (!job) throw Error("Worker lease lost");
    if (raw.action === "heartbeat") {
      await rpc("heartbeat_production", {
        p_job: job.id,
        p_token: job.lease_token,
      });
      return NextResponse.json({ ok: true });
    }
    if (raw.action === "fail") {
      await rpc("fail_production", {
        p_job: job.id,
        p_token: job.lease_token,
        p_error: z.string().max(1500).parse(raw.error),
      });
      return NextResponse.json({ ok: true });
    }
    const p = await currentPackage(rpc, job.package_id);
    if (p.version !== job.package_version)
      throw Error("Production changed while processing");
    if (job.kind === "transcribe" && raw.action === "complete")
      return NextResponse.json(await finishTranscript(rpc, job, raw.result));
    if (job.kind !== "render") throw Error("Invalid worker operation");
    renderSpec(p, job.input.options!);
    if (raw.action === "upload")
      return NextResponse.json(
        await uploadTicket(
          p,
          "render.mp4",
          "video/mp4",
          z.number().int().positive().parse(raw.bytes),
        ),
      );
    if (raw.action === "local_result") {
      if (process.env.CONTENT_OS_MODE === "supabase")
        throw Error("Local artifact upload only available in local demo mode");
      const bytes = Buffer.from(
        z.string().max(14_000_000).parse(raw.data),
        "base64",
      );
      const file = `${p.id}/renders/${digest(bytes)}.mp4`;
      const target = path.resolve(
        process.env.CONTENT_OS_DATA_DIR ?? ".data/newsroom",
        "production",
        file,
      );
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return NextResponse.json({ file_id: file });
    }
    if (raw.action === "complete") {
      const o = z
        .object({
          file_id: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          duration: z.number().positive(),
          bytes: z.number().int().positive(),
          probe: z
            .object({
              width: z.number().int().positive(),
              height: z.number().int().positive(),
              codec: z.literal("h264"),
              container: z.string().refine((v) => v.includes("mp4")),
              duration: z.number().positive(),
              bytes: z.number().int().positive(),
              method: z.enum(["ffprobe", "pyav-libavformat"]),
            })
            .optional(),
          options: renderOptionsSchema,
          subtitles: z.object({
            srt: z.string().max(2000000),
            vtt: z.string().max(2000000),
            json: z.string().max(3000000),
          }),
        })
        .parse(raw.result);
      if (
        Object.entries(o.options).some(
          ([key, value]) =>
            job.input.options?.[key as keyof typeof o.options] !== value,
        )
      )
        throw Error("Render options differ from reviewed job");
      if (
        o.probe &&
        (o.probe.bytes !== o.bytes ||
          Math.abs(o.probe.duration - o.duration) > 0.2)
      )
        throw Error("Final media probe mismatch");
      if (!o.file_id.startsWith(p.id + "/") || o.file_id.includes(".."))
        throw Error("Output belongs to another production");
      if (process.env.CONTENT_OS_MODE === "supabase") {
        const info = await storedInfo(p, o.file_id);
        if (info.bytes !== o.bytes || info.mime !== "video/mp4")
          throw Error("Uploaded render metadata mismatch");
      } else {
        const info = await stat(
          path.resolve(
            process.env.CONTENT_OS_DATA_DIR ?? ".data/newsroom",
            "production",
            o.file_id,
          ),
        );
        if (info.size !== o.bytes) throw Error("Local render size mismatch");
      }
      p.data.output = {
        ...o,
        provider:
          process.env.CONTENT_OS_MODE === "supabase" ? "supabase" : "local",
        filename: "render.mp4",
        mime: "video/mp4",
        production_version: p.version,
        media_id: job.input.media_id,
      };
      p.data.state = "rendered";
      p.data.approval = null;
      return NextResponse.json(await savePackage(rpc, p, "local-worker", job));
    }
    throw Error("Unknown worker operation");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Worker request failed" },
      { status: 422 },
    );
  }
}
