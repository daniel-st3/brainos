import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  // Only these candidate endpoints accept scoped capabilities; handlers authorize every request.
  if (
    /^\/review-link\/[a-f0-9-]{36}$/.test(request.nextUrl.pathname) ||
    /^\/api\/approvals\/[a-f0-9-]{36}(?:\/(?:access|media))?$/.test(
      request.nextUrl.pathname,
    )
  )
    return NextResponse.next();
  // Scheduler bearer is verified by this route; GET still requires editor().
  if (request.nextUrl.pathname === "/api/creator-discovery")
    return NextResponse.next();
  if (
    [
      "/about",
      "/contact",
      "/privacy",
      "/terms",
      "/data-deletion",
      "/content",
      "/manifest.webmanifest",
      "/robots.txt",
      "/sitemap.xml",
      "/offline",
      "/api/public/contact",
      "/api/public/signup",
      "/api/public/unsubscribe",
      "/api/public/share",
    ].includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/builds/")
  )
    return NextResponse.next();
  // This route uses a scoped worker credential, never a browser session.
  if (
    [
      "/api/production/worker",
      "/api/newsroom/worker",
      "/api/automation",
    ].includes(request.nextUrl.pathname)
  )
    return NextResponse.next();
  if (process.env.CONTENT_OS_MODE !== "supabase") {
    if (process.env.VERCEL)
      return new NextResponse(
        "Private hosting requires Supabase configuration.",
        { status: 503 },
      );
    return NextResponse.next();
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return new NextResponse("Supabase configuration is incomplete.", {
      status: 503,
    });
  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
  } = await client.auth.getUser();
  if (
    request.nextUrl.pathname !== "/login" &&
    (!user ||
      !process.env.CONTENT_OS_EDITOR_ID ||
      user.id !== process.env.CONTENT_OS_EDITOR_ID)
  ) {
    if (request.nextUrl.pathname.startsWith("/api/"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|app-icon.png).*)"],
};
