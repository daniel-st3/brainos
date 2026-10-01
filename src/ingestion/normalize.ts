import { createHash } from "node:crypto";
export function canonicalize(input: string, base?: string): string {
  const u = new URL(input, base);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Only credential-free HTTP(S) URLs are supported.");
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()])
    if (
      /^(utm_|fbclid$|gclid$|dclid$|mc_cid$|mc_eid$|ref_src$|ref_url$)/i.test(
        key,
      )
    )
      u.searchParams.delete(key);
  u.searchParams.sort();
  u.pathname =
    u.pathname
      .replace(/%([a-f0-9]{2})/gi, (match, hex) => {
        const c = String.fromCharCode(parseInt(hex, 16));
        return /[a-z0-9\-._~]/i.test(c) ? c : match.toUpperCase();
      })
      .replace(/\/$/, "") || "/";
  if (u.hostname === "github.com") {
    const parts = u.pathname.split("/");
    if (parts[1]) parts[1] = parts[1].toLowerCase();
    if (parts[2]) parts[2] = parts[2].toLowerCase();
    u.pathname = parts.join("/");
  }
  return u.toString();
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Signed GitHub image tokens rotate without changing the underlying asset.
 * Use only for identity; keep the originally discovered URL in provenance. */
export function mediaIdentity(input: string) {
  const url = new URL(canonicalize(input));
  if (url.hostname === "private-user-images.githubusercontent.com")
    url.searchParams.delete("jwt");
  return url.toString();
}
export function stableId(value: string) {
  const h = hash(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function normalizedTitle(title: string) {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function plainText(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(Number(n), 0x10ffff)),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
export function urlsIn(html: string, base: string) {
  const urls: string[] = [];
  for (const match of html.matchAll(
    /(?:href\s*=\s*["']([^"']+)["']|https?:\/\/[^\s<>"']+)/gi,
  )) {
    try {
      urls.push(canonicalize(match[1] ?? match[0], base));
    } catch {
      /* Discard non-web links. */
    }
  }
  return [...new Set(urls)];
}
export function timestamp(input: unknown, now: string): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const n = Date.parse(input);
  return Number.isFinite(n) && n <= Date.parse(now) + 86400000
    ? new Date(n).toISOString()
    : null;
}
export function matchesPrefix(url: string, prefix: string) {
  try {
    const a = new URL(canonicalize(url)),
      b = new URL(canonicalize(prefix));
    return (
      a.origin === b.origin &&
      (a.pathname === b.pathname ||
        a.pathname.startsWith(
          b.pathname.endsWith("/") ? b.pathname : `${b.pathname}/`,
        ))
    );
  } catch {
    return false;
  }
}
