import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { dataMode } from "@/server/mode";
import { applicationRpc } from "@/ingestion/store";
const schema = z.object({
  storyId: z.string().uuid(),
  kind: z.enum(["surfaced", "opened"]),
  briefId: z.string().uuid().nullable(),
  rank: z.number().int().min(1).max(100).nullable(),
});
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
    const actor = await editor();
    if (dataMode() === "demo") return new NextResponse(null, { status: 204 });
    const input = schema.parse(await request.json());
    await (
      await applicationRpc()
    )("record_pilot", {
      p_story: input.storyId,
      p_kind: input.kind,
      p_brief: input.briefId,
      p_rank: input.rank,
      p_actor: actor,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "Observation could not be saved." },
      { status: 422 },
    );
  }
}
