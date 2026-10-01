import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import {
  studio,
  currentPackage,
  productionAction,
  savePackage,
} from "@/production/service";
import {
  teleprompter,
  subtitleAssets,
  platformPackage,
  attachMedia,
} from "@/production/model";
import {
  uploadTicket,
  registerMedia,
  storeGraphic,
  graphicBytes,
  productionBucket,
} from "@/production/storage";
import { storageClient } from "@/integrations/media";
import { graphic } from "@/production/graphics";
import type { Story } from "@/domain/types";
export const dynamic = "force-dynamic";
function failure(e: unknown) {
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Production request failed" },
    { status: e instanceof Error && e.message === "Unauthorized" ? 401 : 422 },
  );
}
export async function GET(request: Request) {
  try {
    await editor();
    const rpc = await applicationRpc(),
      url = new URL(request.url),
      id = url.searchParams.get("id"),
      format = url.searchParams.get("format");
    if (!id && !url.searchParams.get("batch"))
      return NextResponse.json(await studio(rpc));
    let packets;
    if (url.searchParams.get("batch")) {
      const b = (await studio(rpc)).batches.find(
        (b) => b.id === url.searchParams.get("batch"),
      );
      if (!b) throw Error("Batch missing");
      packets = await Promise.all(
        b.package_ids.map((id) => currentPackage(rpc, id)),
      );
    } else packets = [await currentPackage(rpc, id!)];
    const p = packets[0],
      name =
        packets.length > 1
          ? "batch"
          : `${p.id}-r${p.data.packet.revision}-v${p.version}`;
    if (format === "teleprompter" || format === "text")
      return new Response(
        teleprompter(
          packets,
          format === "teleprompter",
          url.searchParams.get("emphasis") === "1",
        ),
        {
          headers: {
            "Content-Type":
              format === "text"
                ? "text/plain; charset=utf-8"
                : "text/html; charset=utf-8",
            "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${name}.${format === "text" ? "txt" : "html"}"`,
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'",
            "Cache-Control": "no-store",
          },
        },
      );
    if (["srt", "vtt", "json"].includes(format ?? "")) {
      if (!p.data.transcript) throw Error("Transcript missing");
      const assets =
        url.searchParams.get("timeline") === "render" &&
        p.data.output?.subtitles
          ? p.data.output.subtitles
          : subtitleAssets(p.data.transcript);
      return new Response(assets[format as keyof typeof assets], {
        headers: {
          "Content-Type":
            format === "json"
              ? "application/json"
              : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.${format}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (format === "output") {
      if (!p.data.output) throw Error("Rendered output missing");
      if (p.data.output.provider === "local") {
        const file = p.data.output.file_id;
        if (!file.startsWith(p.id + "/") || file.includes(".."))
          throw Error("Invalid output path");
        return new Response(
          new Uint8Array(
            await readFile(
              path.resolve(
                process.env.CONTENT_OS_DATA_DIR ?? ".data/newsroom",
                "production",
                file,
              ),
            ),
          ),
          {
            headers: {
              "Content-Type": "video/mp4",
              "Cache-Control": "no-store",
            },
          },
        );
      }
      const { data, error } = await storageClient()
        .storage.from(productionBucket)
        .createSignedUrl(p.data.output.file_id, 300);
      if (error) throw error;
      return NextResponse.redirect(data.signedUrl);
    }
    if (format === "graphic") {
      const asset = p.data.assets.find(
        (a) => a.id === url.searchParams.get("asset"),
      );
      if (!asset) throw Error("Asset missing");
      return new Response(await graphicBytes(p, asset.reference), {
        headers: {
          "Content-Type": "image/svg+xml",
          "Content-Disposition": `attachment; filename="${name}-graphic.svg"`,
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    return new Response(
      JSON.stringify({ packages: packets.map(platformPackage) }, null, 2),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${name}-platform-package.json"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const actor = await editor(),
      rpc = await applicationRpc(),
      raw = await request.json();
    if (["upload", "media", "graphic"].includes(raw.action)) {
      const base = z
          .object({ id: z.uuid(), version: z.number().int().positive() })
          .parse(raw),
        p = await currentPackage(rpc, base.id);
      if (p.version !== base.version)
        throw Error("Conflict: production changed");
      if (raw.action === "upload") {
        const a = z
          .object({
            filename: z.string().min(1).max(240),
            mime: z.string(),
            bytes: z.number().positive(),
          })
          .parse(raw);
        return NextResponse.json(
          await uploadTicket(p, a.filename, a.mime, a.bytes),
        );
      }
      if (raw.action === "media")
        return NextResponse.json(
          await savePackage(
            rpc,
            attachMedia(p, await registerMedia(p, raw.media)),
            actor,
          ),
        );
      const a = z
        .object({
          kind: z.enum(["source", "quote", "stat", "comparison"]),
          source_id: z.uuid(),
          second_source_id: z.uuid().optional(),
          text: z.string().max(300).optional(),
        })
        .parse(raw);
      const story = ((await rpc("read_newsroom")) as Story[]).find(
        (s) => s.id === p.story_id,
      )!;
      const svg = graphic(story, a.kind, a);
      const file = await storeGraphic(p, svg, a.kind);
      p.data.assets.push({
        id: crypto.randomUUID(),
        kind: "source_card",
        title: `${a.kind} card`,
        required: false,
        rights: "unknown",
        publishable: false,
        basis: "",
        attribution: story.sources.find((s) => s.id === a.source_id)!.publisher,
        source_url: story.sources.find((s) => s.id === a.source_id)!
          .canonical_url,
        reference: file,
      });
      p.data.output = null;
      p.data.approval = null;
      if (
        ["rendered", "review", "approved", "render_ready"].includes(
          p.data.state,
        )
      )
        p.data.state = "edit_plan_ready";
      return NextResponse.json(await savePackage(rpc, p, actor));
    }
    return NextResponse.json(await productionAction(rpc, raw, actor));
  } catch (e) {
    return failure(e);
  }
}
