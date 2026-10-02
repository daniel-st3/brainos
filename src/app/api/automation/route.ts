import { NextResponse } from "next/server";
import {
  schedulerAuthorized,
  executeAutomation,
} from "@/operations/automation";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!schedulerAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (dataMode() !== "live") throw Error("Live runtime required");
    const body = await request.json();
    if (!["discovery", "operations"].includes(body.lane))
      throw Error("Unknown lane");
    return NextResponse.json(
      await executeAutomation(
        await applicationRpc(),
        body.lane,
        body.event === "manual" ? "manual" : "schedule",
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Automation failed; inspect authenticated operations health" },
      { status: 503 },
    );
  }
}
