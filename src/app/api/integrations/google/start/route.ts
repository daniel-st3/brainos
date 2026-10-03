import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import {
  createConsent,
  oauthCookie,
  oauthConfiguration,
} from "@/integrations/google-oauth";
export async function GET(request: Request) {
  try {
    const actor = await editor();
    const config = oauthConfiguration();
    // PKCE cookie and callback must use the same host, including preview links.
    if (new URL(request.url).origin !== config.origin) {
      const target = new URL("/api/integrations/google/start", config.origin);
      if (new URL(request.url).searchParams.get("notifications") === "true")
        target.searchParams.set("notifications", "true");
      const response = NextResponse.redirect(target);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const consent = createConsent(
      actor,
      Date.now(),
      new URL(request.url).searchParams.get("notifications") === "true",
    );
    const response = NextResponse.redirect(consent.url);
    response.cookies.set(oauthCookie, consent.cookie, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/integrations/google/callback",
      maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "OAuth configuration required.",
      },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 503,
      },
    );
  }
}
