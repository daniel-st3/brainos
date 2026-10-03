import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { controlSnapshot } from "@/control/service";
import type { Entity } from "@/control/model";
import type { CreativeRecord } from "@/creative/model";
import { canvaHandoff } from "@/creative/handoff";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await editor();
    const { id } = await params;
    const { state, stories } = await controlSnapshot(
      await applicationRpc(),
      dataMode() === "demo",
    );
    const record = state.entities.find(
      (e) => e.kind === "creative" && e.id === id,
    ) as Entity<CreativeRecord> | undefined;
    if (!record) throw Error("Creative record unavailable");
    return NextResponse.json(canvaHandoff(record, state, stories), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="creative-${record.id}-v${record.version}.json"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.message === "Unauthorized"
            ? "Unauthorized"
            : "Current creative handoff unavailable",
      },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 422,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
