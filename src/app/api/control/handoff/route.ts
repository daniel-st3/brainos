import { z } from "zod";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import {
  handoffCsp,
  nativeHandoff,
  nativeHandoffAsset,
  renderNativeHandoff,
} from "@/providers/handoff";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const selection = z.object({
  package_id: z.uuid(),
  package_version: z.number().int().positive(),
});
function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Handoff unavailable" },
    {
      status:
        error instanceof Error && error.message === "Unauthorized" ? 401 : 422,
      headers,
    },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Cross-origin request rejected" },
      { status: 403, headers },
    );
  try {
    await editor();
    const input = selection
      .extend({ format: z.enum(["html", "text", "json"]).default("html") })
      .strict()
      .parse(await request.json());
    const bundle = await nativeHandoff(
      await applicationRpc(),
      input.package_id,
      input.package_version,
      dataMode() === "demo",
      new URL(request.url).origin,
    );
    return new Response(renderNativeHandoff(bundle, input.format), {
      headers: {
        ...headers,
        "Content-Type": {
          html: "text/html; charset=utf-8",
          text: "text/plain; charset=utf-8",
          json: "application/json; charset=utf-8",
        }[input.format],
        "Content-Disposition": `attachment; filename="brainos-${bundle.platform}-${bundle.package_id}-v${bundle.package_version}.${input.format === "text" ? "txt" : input.format}"`,
        "Content-Security-Policy": handoffCsp,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Read-only downloads also work from the saved HTML; authentication is required every time. */
export async function GET(request: Request) {
  // A saved HTML file has an opaque origin. Allow its deliberate top-level
  // navigation, while rejecting cross-site fetches and embedded downloads.
  const userNavigation =
    request.headers.get("sec-fetch-mode") === "navigate" &&
    request.headers.get("sec-fetch-dest") === "document" &&
    request.headers.get("sec-fetch-user") === "?1";
  if (
    (request.headers.get("sec-fetch-site") === "cross-site" &&
      !userNavigation) ||
    (request.headers.has("origin") && !sameOrigin(request))
  )
    return Response.json(
      { error: "Cross-origin request rejected" },
      { status: 403, headers },
    );
  try {
    await editor();
    const url = new URL(request.url),
      input = selection
        .extend({
          package_version: z.coerce.number().int().positive(),
          asset: z.coerce.number().int().positive(),
        })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
    const asset = await nativeHandoffAsset(
      await applicationRpc(),
      input.package_id,
      input.package_version,
      dataMode() === "demo",
      input.asset,
    );
    return new Response(Uint8Array.from(asset.bytes), {
      headers: {
        ...headers,
        "Content-Type": asset.mime,
        "Content-Disposition": `attachment; filename="${asset.name}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
