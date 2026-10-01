import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { dataMode } from "@/server/mode";
import { ingestionStore } from "@/ingestion/store";
import { runIngestion } from "@/ingestion/pipeline";
import { sourceDefinitions } from "@/ingestion/registry";
export const maxDuration = 300;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), sourceId: z.string().optional() }),
  z.object({
    action: z.literal("toggle"),
    sourceId: z.string(),
    active: z.boolean(),
  }),
]);
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403 },
      );
    await editor();
    if (dataMode() !== "live")
      throw new Error("Live ingestion is disabled in demo mode.");
    const input = schema.parse(await request.json());
    const store = await ingestionStore();
    await store.ensureSources(sourceDefinitions);
    if (input.action === "toggle") {
      if (!sourceDefinitions.some((s) => s.id === input.sourceId))
        throw new Error("Unknown source");
      await store.rpc("set_source_active", {
        p_id: input.sourceId,
        p_active: input.active,
      });
      return NextResponse.json({ message: "Source setting saved." });
    }
    if (
      input.sourceId &&
      !sourceDefinitions.some((s) => s.id === input.sourceId)
    )
      throw new Error("Unknown source");
    const runs = await runIngestion(store, {
      sourceIds: input.sourceId ? [input.sourceId] : undefined,
    });
    return NextResponse.json({
      message: `${runs.filter((r) => r.status === "success").length}/${runs.length} sources succeeded. ${runs.reduce((n, r) => n + r.new_stories, 0)} new stories. See source health for errors.`,
      runs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ingestion failed" },
      { status: 422 },
    );
  }
}
