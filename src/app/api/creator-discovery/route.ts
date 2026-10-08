import { NextResponse } from "next/server";
import { schedulerAuthorized } from "@/operations/automation";
import { applicationRpc } from "@/ingestion/store";
import { editor } from "@/server/auth";
import { runCreatorDiscovery } from "@/creator/discovery";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await editor();
    return NextResponse.json(
      await (
        await applicationRpc()
      )("read_creator_runs"),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
export async function POST(request: Request) {
  if (!schedulerAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.BRAINOS_CREATOR_STAGING !== "true")
    return NextResponse.json(
      { error: "CREATOR_STAGING_DISABLED" },
      { status: 409 },
    );
  try {
    return NextResponse.json(await runCreatorDiscovery(await applicationRpc()));
  } catch {
    return NextResponse.json(
      { error: "Creator discovery failed; existing newsroom unaffected" },
      { status: 503 },
    );
  }
}
