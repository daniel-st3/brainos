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
    const index = Number(new URL(request.url).searchParams.get("slide") ?? 0);
    if (!Number.isInteger(index) || index < 0 || !g)
      throw Error("Graphic missing");
    const outputs = g.data.outputs as { svg: string }[] | undefined;
    if (!outputs?.[index]) throw Error("Rendered slide missing");
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
