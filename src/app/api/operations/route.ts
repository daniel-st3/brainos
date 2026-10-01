import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enqueue"),
    kind: z.enum(["enrich", "production", "post_recording"]),
    storyId: z.string().uuid(),
    draftId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("confirm_opinion"),
    storyId: z.string().uuid(),
    angleId: z.string().uuid(),
    topic: z.string().trim().min(1).max(200),
    context: z.string().max(12000),
    confirmed: z.literal(true),
    supersedes: z.string().uuid().optional(),
  }),
]);
export async function GET() {
  try {
    await editor();
    return NextResponse.json(await (await applicationRpc())("read_operations"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Read failed" },
      { status: 401 },
    );
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const actor = await editor();
    const body = requestSchema.parse(await request.json());
    const rpc = await applicationRpc();
    if (body.action === "confirm_opinion")
      return NextResponse.json({
        id: await rpc("confirm_opinion", {
          p_story: body.storyId,
          p_angle: body.angleId,
          p_topic: body.topic,
          p_context: body.context,
          p_actor: actor,
          p_confirmed: true,
          p_supersedes: body.supersedes ?? null,
        }),
      });
    const stories = (await rpc(
      "read_newsroom",
    )) as import("@/domain/types").Story[];
    const story = stories.find((s) => s.id === body.storyId);
    if (!story) throw new Error("Story missing");
    const { evidenceFingerprint } = await import("@/operations/research");
    const fingerprint = evidenceFingerprint(story);
    return NextResponse.json(
      {
        id: await rpc("enqueue_operation", {
          p_kind: body.kind,
          p_key: `${body.kind}:${story.id}:${body.draftId ?? fingerprint}`,
          p_story: story.id,
          p_payload: { draftId: body.draftId, fingerprint },
        }),
      },
      { status: 202 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Request failed" },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 422,
      },
    );
  }
}
