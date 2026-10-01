import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { dataMode } from "@/server/mode";
import { applicationRpc } from "@/ingestion/store";
import { dateOnly, daySchema } from "@/domain/pilot";
import { z } from "zod";
const startSchema = z.object({
  action: z.literal("start"),
  starts_on: dateOnly,
});
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403 },
      );
    const actor = await editor();
    if (dataMode() !== "live")
      throw new Error("The pilot is available in live mode.");
    const raw = await request.text();
    if (raw.length > 15000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const input = JSON.parse(raw);
    const rpc = await applicationRpc();
    if (input.action === "start") {
      const p = startSchema.parse(input);
      await rpc("start_pilot", { p_start: p.starts_on, p_actor: actor });
      return NextResponse.json({
        message: "Ten-day pilot started. Dates use Bogotá time.",
      });
    }
    if (input.action !== "save_day") throw new Error("Unknown pilot action");
    const day = daySchema.parse(input);
    await rpc("save_pilot_day", { p_day: day, p_actor: actor });
    return NextResponse.json({ message: "Daily comparison saved." });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save pilot";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 422 },
    );
  }
}
