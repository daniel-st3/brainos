import { brandedGenerator } from "@/control/generation";
import { readControl } from "@/control/service";
import { applicationRpc } from "@/ingestion/store";
import { demoAI } from "@/services/ai";
import { liveEditorial } from "@/services/live-editorial";
import { sameOrigin } from "@/server/request";
import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { readStories, saveStory } from "@/server/repository";
import { requestSchema } from "@/domain/commands";
import { applyCommand } from "@/domain/workflow";
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403 },
      );
    const actor = await editor();
    const raw = await request.text();
    if (raw.length > 100_000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const parsed = requestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(" ") },
        { status: 400 },
      );
    const { storyId, expectedVersion, command } = parsed.data;
    const story = (await readStories()).find((s) => s.id === storyId);
    if (!story)
      return NextResponse.json({ error: "Story not found." }, { status: 404 });
    if (story.version !== expectedVersion)
      return NextResponse.json(
        {
          error:
            "This story changed in another tab. Refresh before trying again.",
        },
        { status: 409 },
      );
    const state = await readControl(await applicationRpc(), story.is_demo);
    const generator = brandedGenerator(
      story.is_demo ? demoAI : liveEditorial,
      state,
    );
    const updated = await applyCommand(
      story,
      command,
      actor,
      undefined,
      generator,
    );
    await saveStory(updated, expectedVersion);
    return NextResponse.json({ ok: true, version: updated.version });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save.";
    return NextResponse.json(
      { error: message },
      {
        status:
          message === "Unauthorized"
            ? 401
            : message.includes("Conflict")
              ? 409
              : 422,
      },
    );
  }
}
