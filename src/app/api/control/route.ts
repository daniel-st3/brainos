import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { controlAction, controlSnapshot, actions } from "@/control/service";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await editor();
    const snapshot = await controlSnapshot(
      await applicationRpc(),
      dataMode() === "demo",
    );
    return NextResponse.json(
      {
        ...snapshot,
        actions: actions(snapshot.state, snapshot.stories, snapshot.production),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const actor = await editor(),
      text = await request.text();
    if (text.length > 100000) throw Error("Request too large");
    const raw = JSON.parse(text);
    if (!Number.isInteger(raw.epoch) || raw.epoch < 0)
      throw Error("Current revision required");
    return NextResponse.json(
      await controlAction(
        await applicationRpc(),
        raw.command,
        actor,
        dataMode() === "demo",
        raw.epoch,
      ),
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unable to save";
    return NextResponse.json(
      { error },
      {
        status:
          error === "Unauthorized"
            ? 401
            : error.includes("Conflict")
              ? 409
              : 422,
      },
    );
  }
}
