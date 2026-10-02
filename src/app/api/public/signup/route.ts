import { NextResponse } from "next/server";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { signup } from "@/control/public";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const text = await request.text();
    if (text.length > 1000) throw Error("Request too large");
    const body = JSON.parse(text);
    if (body.website) throw Error("Unable to subscribe");
    const token = await signup(
      await applicationRpc(),
      String(body.email ?? "").trim(),
      body.consent === true,
    );
    return NextResponse.json(
      {
        saved: true,
        unsubscribe_token: token,
        message: "Consent saved. No marketing emails are being sent yet.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Valid email and explicit consent required" },
      { status: 422 },
    );
  }
}
