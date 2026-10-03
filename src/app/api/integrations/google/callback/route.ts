import {
  DriveVerificationError,
  verifyPersonalDrive,
} from "@/integrations/personal-drive";
import { NextResponse, type NextRequest } from "next/server";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import {
  googleDriveScope,
  gmailSendScope,
  oauthConfiguration,
  oauthCookie,
  sealSecret,
  validateConsentDetails,
} from "@/integrations/google-oauth";
export async function GET(request: NextRequest) {
  let response: NextResponse;
  try {
    const actor = await editor(),
      config = oauthConfiguration();
    const state = request.nextUrl.searchParams.get("state"),
      code = request.nextUrl.searchParams.get("code"),
      cookie = request.cookies.get(oauthCookie)?.value;
    if (!state || !code || !cookie || request.nextUrl.searchParams.has("error"))
      throw new Error("Google consent was denied, expired or incomplete.");
    const { verifier, notifications } = validateConsentDetails(
      cookie,
      state,
      actor,
    );
    const result = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok)
      throw new Error(
        "Google authorization-code exchange failed. Start authorization again.",
      );
    const token = (await result.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
    };
    if (
      !token.access_token ||
      !token.refresh_token ||
      !token.scope?.split(" ").includes(googleDriveScope)
    )
      throw new Error("Offline Drive consent was not granted.");
    if (notifications && !token.scope.split(" ").includes(gmailSendScope))
      throw new Error(
        "Gmail send consent was not granted. Existing Drive connection was preserved.",
      );
    const verified = await verifyPersonalDrive(token.access_token, true);
    await (
      await applicationRpc()
    )("save_google_connection", {
      p_ciphertext: sealSecret(token.refresh_token, "refresh"),
      p_scopes: token.scope.split(" "),
      p_actor: actor,
    });
    console.info("BrainOS Drive verified", {
      email: verified.email,
      root: verified.root,
      folderGet: 200,
      childrenList: 200,
    });
    response = NextResponse.redirect(
      new URL(
        notifications
          ? "/review?gmail=connected"
          : "/production/studio?google=connected",
        config.origin,
      ),
    );
  } catch (e) {
    if (e instanceof DriveVerificationError)
      console.error("BrainOS Drive verification failed", e.diagnostic);
    response = NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Google authorization failed.",
        ...(e instanceof DriveVerificationError ? { drive: e.diagnostic } : {}),
      },
      {
        status: e instanceof Error && e.message === "Unauthorized" ? 401 : 422,
      },
    );
  }
  response.cookies.set(oauthCookie, "", {
    path: "/api/integrations/google/callback",
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
