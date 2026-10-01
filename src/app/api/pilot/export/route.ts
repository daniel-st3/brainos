import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { dataMode } from "@/server/mode";
import { ingestionStore } from "@/ingestion/store";
import { pilotStoryEvents, type PilotStudy } from "@/domain/pilot";
import { strongestSource } from "@/ingestion/provenance";
export async function GET() {
  try {
    await editor();
    if (dataMode() !== "live")
      return NextResponse.json(
        { error: "Switch to live mode to export the pilot." },
        { status: 400 },
      );
    const store = await ingestionStore();
    const study = (await store.rpc("read_pilot_study")) as PilotStudy;
    if (!study.config)
      return NextResponse.json(
        { error: "Start the pilot first." },
        { status: 409 },
      );
    const events = pilotStoryEvents(
      (await store.state()).pilot,
      study.config.starts_on,
    );
    const ids = new Set(events.map((e) => e.story_id));
    const stories = (await store.readStories())
      .filter((s) => !s.is_demo && ids.has(s.id))
      .map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        source_url: strongestSource(s)?.canonical_url ?? null,
        manual_only: s.discovery?.manual_only ?? false,
      }));
    return new Response(
      JSON.stringify(
        {
          schema: "content-os-pilot/v1",
          exported_at: new Date().toISOString(),
          timezone: "America/Bogota",
          study,
          events,
          stories,
          limitations: [
            "Useful-story counts and minutes are self-reported.",
            "Browser observations are best-effort, not complete recall measurement.",
            "Draft creation is not publication or audience performance.",
            "Later draft-creation events remain included for stories observed during the pilot window.",
          ],
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="content-os-pilot-${study.config.starts_on}.json"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 401 },
    );
  }
}
