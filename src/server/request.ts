export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      (process.env.CONTENT_OS_ORIGIN
        ? url.origin === process.env.CONTENT_OS_ORIGIN
        : url.host === request.headers.get("host")) &&
      request.headers.get("sec-fetch-site") !== "cross-site"
    );
  } catch {
    return false;
  }
}
