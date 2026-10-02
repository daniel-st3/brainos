import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { readControl } from "@/control/service";
import { dataMode } from "@/server/mode";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await editor();
    const { id } = await params,
      s = await readControl(await applicationRpc(), dataMode() === "demo"),
      g = s.entities.find((e) => e.kind === "graphic" && e.id === id);
    if (new URL(request.url).searchParams.get("format") === "manifest") {
      const { orderedCarousel } = await import("@/providers/carousel");
      const exported = await orderedCarousel(
        await applicationRpc(),
        id,
        dataMode() === "demo",
      );
      return NextResponse.json(
        {
          graphic_id: id,
          revision: exported.graphic.version,
          template_version: exported.graphic.data.template_version,
          rights: exported.graphic.data.rights,
          slides: exported.slides.map(({ bytes, ...s }) => ({
            ...s,
            bytes: bytes.length,
            download: `/api/control/graphics/${id}?slide=${s.order - 1}&format=png`,
          })),
        },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    const index = Number(new URL(request.url).searchParams.get("slide") ?? 0);
    if (!Number.isInteger(index) || index < 0 || !g)
      throw Error("Graphic missing");
    const outputs = g.data.outputs as
      | { svg: string; sha256: string; png?: { source_svg_sha256: string } }[]
      | undefined;
    if (!outputs?.[index]) throw Error("Rendered slide missing");
    if (new URL(request.url).searchParams.get("format") === "png") {
      const o = outputs[index];
      if (!o.png || o.png.source_svg_sha256 !== o.sha256)
        throw Error("Raster missing/stale");
      const { rasterBytes } = await import("@/providers/raster");
      return new Response(
        Uint8Array.from(await rasterBytes(id, o.sha256, dataMode() === "demo")),
        {
          headers: {
            "Content-Type": "image/png",
            "Content-Disposition": `attachment; filename="${id}-${index + 1}.png"`,
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    return new Response(outputs[index].svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${id}-${index + 1}.svg"`,
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Graphic unavailable" }, { status: 404 });
  }
}
