import { NextResponse } from "next/server";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { unsubscribe } from "@/control/public";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const text = await request.text();
    if (text.length > 200) throw Error("Too large");
    await unsubscribe(await applicationRpc(), JSON.parse(text).token);
    return NextResponse.json({ unsubscribed: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid unsubscribe reference" },
      { status: 422 },
    );
  }
}
