import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import type { ReviewMedia } from "@/approval/model";
import { findReview } from "@/approval/service";
import { storageClient } from "@/integrations/media";
import { rasterBytes } from "@/providers/raster";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await editor();
    const row = await findReview(
      await applicationRpc(),
      (await context.params).id,
    );
    const index = Number(new URL(request.url).searchParams.get("index"));
    if (!Number.isInteger(index) || index < 0) throw Error("Missing media");
    const file: ReviewMedia | undefined =
      new URL(request.url).searchParams.get("poster") === "true"
        ? row.data.frozen.imported?.poster
        : row.data.frozen.media[index];
    if (!file) throw Error("Missing media");
    if (
      process.env.CONTENT_OS_MODE !== "supabase" &&
      row.is_demo &&
      file.graphic_id &&
      file.source_sha256
    ) {
      const bytes = await rasterBytes(
        file.graphic_id,
        file.source_sha256,
        true,
      );
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const { data, error } = await storageClient()
      .storage.from("brainos-production")
      .createSignedUrl(file.file_id, 300);
    if (error || !data) throw Error("Media unavailable");
    return NextResponse.redirect(data.signedUrl, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Media unavailable" },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 404,
      },
    );
  }
}
