import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { activationAction, activationState } from "@/providers/activation";
import { providerCookie } from "@/providers/auth";
import type { Provider } from "@/control/model";
export async function GET() {
  try {
    await editor();
    return NextResponse.json(
      await activationState(await applicationRpc(), dataMode() === "demo"),
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
      text = await request.text();
    if (text.length > 15000) throw Error("Request too large");
    const c = JSON.parse(text);
    if (
      c.action === "auth_start" &&
      new URL(request.url).origin !== process.env.CONTENT_OS_ORIGIN
    )
      return NextResponse.json({
        url: process.env.CONTENT_OS_ORIGIN + "/activation",
      });
    const result = await activationAction(
      await applicationRpc(),
      c,
      actor,
      dataMode() === "demo",
    );
    if (c.action === "auth_start") {
      const consent = result as { url: string; cookie: string };
      const response = NextResponse.json({ url: consent.url });
      response.cookies.set(
        providerCookie(c.provider as Provider),
        consent.cookie,
        {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge: 600,
          path: "/",
        },
      );
      return response;
    }
    if (c.action === "buffer_delivery")
      return NextResponse.json({ saved: true, ...result });
    return NextResponse.json({ saved: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Activation failed" },
      { status: 422 },
    );
  }
}
