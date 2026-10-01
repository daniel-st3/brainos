import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { dataMode } from "@/server/mode";
import { ingestionStore } from "@/ingestion/store";
import { sourceDefinitions } from "@/ingestion/registry";
import { makeDiscovery } from "@/ingestion/adapters";
import { persistDiscovery } from "@/ingestion/pipeline";
const schema = z.object({
  title: z.string().trim().min(5).max(500),
  url: z.string().url(),
  notes: z.string().trim().max(10000),
});
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403 },
      );
    await editor();
    if (dataMode() !== "live")
      throw new Error("Missed-story tracking is available in live mode.");
    const input = schema.parse(await request.json());
    const store = await ingestionStore();
    await store.ensureSources(sourceDefinitions);
    const source = sourceDefinitions.find((s) => s.id === "manual")!;
    const now = new Date().toISOString();
    const item = makeDiscovery(
      source,
      {
        id: input.url,
        url: input.url,
        title: input.title,
        body:
          input.notes ||
          "Manually supplied lead. Source contents have not been fetched.",
      },
      now,
    );
    const owner = crypto.randomUUID();
    if (!(await store.lease(owner)))
      throw new Error(
        "Ingestion is running. Try saving the missed story again shortly.",
      );
    try {
      const result = await persistDiscovery(store, item, source, owner);
      return NextResponse.json({
        message: "Missed story saved as an unverified lead.",
        href: `/stories/${result.storyId}?tab=sources`,
      });
    } finally {
      await store.release(owner);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save discovery." },
      { status: 422 },
    );
  }
}
