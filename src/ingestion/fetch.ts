import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
let dispatcher: EnvHttpProxyAgent | undefined;
export async function closeFeedConnections() {
  await dispatcher?.close();
  dispatcher = undefined;
}
function privateAddress(address: string) {
  return (
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|22[4-9]\.|23\d\.)/.test(
      address,
    ) ||
    address === "::" ||
    address === "::1" ||
    /^(fc|fd|fe[89ab]|ff)/i.test(address) ||
    address.includes("::ffff:")
  );
}
export async function assertPublicUrl(input: string, resolveDns = true) {
  const u = new URL(input);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new Error("Unsafe fetch URL.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (!host.includes(".") && !isIP(host))
  )
    throw new Error("Private host rejected.");
  if (isIP(host)) {
    if (privateAddress(host)) throw new Error("Private address rejected.");
  } else if (resolveDns) {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
      throw new Error("Private DNS destination rejected.");
  }
  return u;
}
export interface FetchResult {
  body: string;
  url: string;
  status: number;
  etag?: string;
  lastModified?: string;
  contentType: string;
}
/** Bounded plain HTTP fetch; honors the configured outbound proxy. No browser, cookies, or credentials. */
export async function fetchPublic(
  input: string,
  headers: Record<string, string> = {},
  allowedOrigins?: string[],
): Promise<FetchResult> {
  let url = input;
  for (let hop = 0; hop < 4; hop++) {
    const proxied = !!(
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.https_proxy ||
      process.env.http_proxy
    );
    // A configured outbound proxy resolves registered hosts itself. This environment has no direct DNS route.
    if (proxied && !allowedOrigins?.length)
      throw new Error("Proxied fetches require explicit allowed origins.");
    const u = await assertPublicUrl(url, !proxied);
    if (allowedOrigins && !allowedOrigins.includes(u.origin))
      throw new Error("Redirect left the configured source origins.");
    dispatcher ??= new EnvHttpProxyAgent();
    const response = await proxyFetch(u, {
      dispatcher,
      redirect: "manual",
      headers: {
        "User-Agent":
          "ContentOS/0.2 (private editorial research; public feeds only)",
        Accept:
          "application/atom+xml, application/rss+xml, application/json, text/html;q=0.7",
        ...headers,
      },
      signal: AbortSignal.timeout(20000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect has no location.");
      url = new URL(location, url).toString();
      continue;
    }
    if (response.status === 304)
      return { body: "", url, status: 304, contentType: "" };
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status} from ${u.hostname}`);
    }
    if (Number(response.headers.get("content-length")) > 2_000_000) {
      await response.body?.cancel();
      throw new Error("Source exceeded 2 MB response limit.");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error("Source exceeded 2 MB response limit.");
        }
        chunks.push(value);
      }
    return {
      body: Buffer.concat(chunks).toString("utf8"),
      url,
      status: response.status,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      contentType: response.headers.get("content-type") ?? "",
    };
  }
  throw new Error("Too many redirects.");
}
