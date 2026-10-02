/** Public destinations must never expose credentials or private storage references. */
export function validatePublicLink(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("A public HTTPS URL is required");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    host === "localhost" ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.includes(":") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    /(^|\.)(supabase\.co|supabase\.in|googleusercontent\.com)$/.test(host) ||
    ["drive.google.com", "docs.google.com"].includes(host) ||
    [...url.searchParams.keys()].some((key) =>
      /token|secret|signature|credential|authorization|api.?key|capability/i.test(
        key,
      ),
    )
  )
    throw Error(
      "Use a public destination without credentials, private Drive, or storage access links",
    );
  return url.href;
}
