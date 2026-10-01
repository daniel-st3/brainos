import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { readStories } from "@/server/repository";
import { applicationRpc } from "@/ingestion/store";
import { sourceCard } from "@/operations/production";
import { storeArtifact } from "@/integrations/media";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const actor = await editor();
    const { storyId } = z
      .object({ storyId: z.string().uuid() })
      .parse(await request.json());
    const story = (await readStories()).find((s) => s.id === storyId);
    if (!story) throw new Error("Story missing");
    return NextResponse.json(
      await storeArtifact(await applicationRpc(), {
        storyId,
        name: "source-card.svg",
        mime: "image/svg+xml",
        bytes: new TextEncoder().encode(sourceCard(story)),
        actor,
        origin:
          "Programmatic text-only working card; human review and editorial asset clearance required.",
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Artifact failed" },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 422,
      },
    );
  }
}
