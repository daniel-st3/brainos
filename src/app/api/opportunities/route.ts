import { NextResponse } from "next/server";
import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { csv } from "@/control/export";
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sync_subscribers"),
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("review"),
    id: z.uuid(),
    status: z.enum([
      "reviewed",
      "qualified",
      "not_a_fit",
      "contacted",
      "closed",
    ]),
  }),
  z.object({
    action: z.literal("delete_personal_data"),
    email: z.email(),
    confirmed: z.literal(true),
  }),
]);
export async function GET(request: Request) {
  try {
    await editor();
    const rpc = await applicationRpc();
    if (new URL(request.url).searchParams.get("export") === "subscribers") {
      const rows = (await rpc("read_subscribers")) as Record<string, unknown>[];
      return new Response(csv(rows), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=subscribers-consent.csv",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return NextResponse.json(
      { opportunities: await rpc("read_opportunities") },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  try {
    const actor = await editor(),
      c = command.parse(await request.json()),
      rpc = await applicationRpc();
    if (c.action === "sync_subscribers") {
      const { syncSubscribers } = await import("@/providers/subscribers");
      return NextResponse.json(await syncSubscribers(rpc));
    }
    if (c.action === "review")
      await rpc("review_opportunity", {
        p_id: c.id,
        p_status: c.status,
        p_actor: actor,
      });
    else await rpc("delete_intake_data", { p_email: c.email, p_actor: actor });
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ error: "Request rejected" }, { status: 422 });
  }
}
