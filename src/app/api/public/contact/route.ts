import { NextResponse } from "next/server";
import { sameOrigin } from "@/server/request";
import { submitOpportunity } from "@/control/opportunities";
import { applicationRpc } from "@/ingestion/store";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 8000) throw Error("Too large");
    await submitOpportunity(
      await applicationRpc(),
      JSON.parse(text),
      request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown",
    );
    return NextResponse.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Revisa los campos y consentimiento, o intenta más tarde." },
      { status: 422 },
    );
  }
}
