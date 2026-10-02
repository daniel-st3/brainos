import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { platforms, type Provider } from "@/control/model";
import { finishProviderAuth, providerCookie } from "@/providers/auth";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const p = (await params).provider as Provider,
    u = new URL(request.url);
  if (!platforms.includes(p) || p === "beehiiv")
    return NextResponse.json(
      { error: "Unknown OAuth provider" },
      { status: 404 },
    );
  try {
    const jar = await cookies(),
      cookie = jar.get(providerCookie(p))?.value;
    if (!cookie || u.searchParams.has("error"))
      throw Error("Consent not completed");
    await finishProviderAuth(
      await applicationRpc(),
      p,
      await editor(),
      cookie,
      u.searchParams.get("state") ?? "",
      u.searchParams.get("code") ?? "",
    );
    jar.delete(providerCookie(p));
    return NextResponse.redirect(
      new URL(
        "/activation?connection=select-account",
        process.env.CONTENT_OS_ORIGIN,
      ),
    );
  } catch {
    try {
      const actor = await editor(),
        rpc = await applicationRpc();
      const { recordOAuthFailure } = await import("@/providers/auth");
      await recordOAuthFailure(rpc, p, actor);
    } catch {}
    return NextResponse.json(
      {
        error:
          "Provider connection failed. Review application settings/scopes and retry from Account Activation; no credentials were exposed.",
      },
      { status: 422 },
    );
  }
}
