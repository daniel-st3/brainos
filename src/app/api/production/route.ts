import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { readStories } from "@/server/repository";
import { approvedProductionPacket } from "@/operations/production";
import { publishingHandoff } from "@/integrations/publishing";
export async function GET(request: Request) {
  try {
    await editor();
    const url = new URL(request.url),
      ids = url.searchParams.getAll("draft");
    const stories = await readStories();
    const publication = url.searchParams.get("publication");
    if (publication) {
      const story = stories.find((s) =>
        s.publications.some((p) => p.id === publication),
      );
      if (!story) throw new Error("Publication missing");
      return NextResponse.json(publishingHandoff(story, publication));
    }
    if (!ids.length || ids.length > 20)
      throw new Error("Select 1–20 approved draft IDs for a recording batch.");
    const packets = ids.map((id) => {
      const story = stories.find((s) => s.drafts.some((d) => d.id === id));
      if (!story) throw new Error("Draft missing");
      return approvedProductionPacket(story, id);
    });
    if (url.searchParams.get("format") === "text")
      return new Response(
        packets
          .map(
            (p) =>
              `REVISION ${p.revision} · ${p.draft_id}\n\n${p.teleprompter}`,
          )
          .join("\n\n-----\n\n"),
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": 'attachment; filename="recording-batch.txt"',
          },
        },
      );
    return NextResponse.json({ packets });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 422,
      },
    );
  }
}
