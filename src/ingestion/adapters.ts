import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  canonicalize,
  hash,
  plainText,
  timestamp,
  urlsIn,
  matchesPrefix,
  mediaIdentity,
} from "./normalize";
import { fetchPublic, type FetchResult } from "./fetch";
import type { Discovery, SourceAdapter, SourceDefinition } from "./types";
export const list = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : strValue(obj(value)["#text"]);
const strValue = (value: unknown) => (typeof value === "string" ? value : "");
function linkValue(item: Record<string, unknown>, rel: string) {
  return list(item.link)
    .map(obj)
    .find((link) => str(link["@_rel"]) === rel)?.["@_href"];
}
export function makeDiscovery(
  source: SourceDefinition,
  input: {
    id: string;
    url: string;
    canonical?: string;
    title: string;
    body: string;
    published?: string;
    updated?: string;
    author?: string;
    images?: string[];
  },
  now: string,
): Discovery {
  const originalUrl = new URL(input.url, source.endpoint).toString();
  if (
    source.itemPrefixes.length &&
    !source.itemPrefixes.some((p) => matchesPrefix(originalUrl, p))
  )
    throw new Error("Feed item URL is outside its registered publisher scope.");
  const provided =
    input.canonical && new URL(input.canonical, originalUrl).toString();
  const canonicalUrl = canonicalize(
    provided && source.itemPrefixes.some((p) => matchesPrefix(provided, p))
      ? provided
      : originalUrl,
  );
  const rawExcerpt = input.body.slice(0, 64000);
  const excerpt = (plainText(rawExcerpt) || input.title).slice(0, 12000);
  const links = urlsIn(rawExcerpt, originalUrl);
  const publishedAt = timestamp(input.published, now),
    updatedAt = timestamp(input.updated, now);
  const release = source.type === "official_release";
  const title = (
    release
      ? `${source.name} — ${plainText(input.title)}`
      : plainText(input.title)
  ).slice(0, 500);
  const version = release
    ? input.title.trim()
    : (input.title.match(/\bv?\d+(?:\.\d+){1,3}(?:[-\w.]*)/i)?.[0] ?? null);
  const images = [
    ...(input.images ?? []),
    ...Array.from(
      rawExcerpt.matchAll(/<img[^>]+src=["']([^"']+)["']/gi),
      (m) => m[1],
    ),
  ]
    .flatMap((x) => {
      try {
        return [canonicalize(x, originalUrl)];
      } catch {
        return [];
      }
    })
    .slice(0, 4);
  return {
    externalId: input.id || canonicalUrl,
    originalUrl,
    canonicalUrl,
    title,
    excerpt,
    rawExcerpt,
    publishedAt,
    updatedAt,
    originalTimestamp: input.published || input.updated || null,
    timestampNote: publishedAt
      ? "Publisher-supplied publication time"
      : updatedAt
        ? "Feed update time only; original publication time is not supplied"
        : "Publication time unavailable or invalid",
    author: input.author ?? "",
    links,
    images,
    entity: source.entities[0] ?? "",
    version,
    eventKind: release
      ? "release"
      : /pric|cost|billing/i.test(title)
        ? "pricing"
        : /paper|research|benchmark/i.test(title)
          ? "research"
          : "announcement",
    primaryReferences: [],
    contentHash: hash(
      JSON.stringify([
        canonicalUrl,
        title,
        excerpt,
        publishedAt,
        updatedAt,
        images.map(mediaIdentity),
      ]),
    ),
    fetchedAt: now,
    registryId: source.id,
  };
}
export function parseFeed(
  body: string,
  source: SourceDefinition,
  now: string,
): Discovery[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(body))
    throw new Error("DTD/entity declarations are not accepted.");
  if (XMLValidator.validate(body) !== true)
    throw new Error("Invalid XML feed.");
  const parsed = obj(
    new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: true,
    }).parse(body),
  );
  const atom = obj(parsed.feed),
    rss = obj(obj(parsed.rss).channel);
  if (!parsed.feed && !parsed.rss)
    throw new Error("Response is neither RSS nor Atom.");
  const entries = list(parsed.feed ? atom.entry : rss.item);
  return entries.map((value) => {
    const item = obj(value);
    const isAtom = !!parsed.feed;
    const url = isAtom
      ? str(
          linkValue(item, "alternate") ??
            list(item.link)
              .map(obj)
              .find((l) => !l["@_rel"])?.["@_href"],
        )
      : str(item.link);
    if (!url) throw new Error("Feed item has no public article URL.");
    const media = obj(item["media:thumbnail"]);
    const enclosure = obj(item.enclosure);
    return makeDiscovery(
      source,
      {
        id: str(item.id ?? item.guid),
        url,
        canonical: str(linkValue(item, "canonical")),
        title: str(item.title),
        body: str(
          item["content:encoded"] ??
            item.content ??
            item.description ??
            item.summary,
        ),
        published: str(item.published ?? item.pubDate ?? item["dc:date"]),
        updated: str(item.updated),
        author: str(obj(item.author).name ?? item.author ?? item["dc:creator"]),
        images: [
          str(media["@_url"]),
          /^image\//.test(str(enclosure["@_type"]))
            ? str(enclosure["@_url"])
            : "",
        ].filter(Boolean),
      },
      now,
    );
  });
}
export type Fetcher = (
  url: string,
  headers?: Record<string, string>,
  origins?: string[],
) => Promise<FetchResult>;
export function adapters(
  fetcher: Fetcher = fetchPublic,
): Record<"feed" | "github_api", SourceAdapter> {
  const retrieve = async (
    source: SourceDefinition,
    options: {
      now: string;
      etag?: string | null;
      lastModified?: string | null;
    },
  ) => {
    const headers: Record<string, string> = {};
    if (options.etag) headers["If-None-Match"] = options.etag;
    if (options.lastModified)
      headers["If-Modified-Since"] = options.lastModified;
    return fetcher(source.endpoint, headers, [new URL(source.endpoint).origin]);
  };
  return {
    feed: {
      async fetch(source, options) {
        const result = await retrieve(source, options);
        if (result.status === 304)
          return { items: [], fetchedCount: 0, notModified: true };
        const items = parseFeed(result.body, source, options.now);
        return {
          items,
          fetchedCount: items.length,
          etag: result.etag,
          lastModified: result.lastModified,
        };
      },
    },
    github_api: {
      async fetch(source, options) {
        const result = await retrieve(source, options);
        if (result.status === 304)
          return { items: [], fetchedCount: 0, notModified: true };
        const entries: unknown = JSON.parse(result.body);
        if (!Array.isArray(entries))
          throw new Error("GitHub releases API must return an array.");
        const items = entries
          .map(obj)
          .filter((e) => !e.draft)
          .map((e) =>
            makeDiscovery(
              source,
              {
                id: String(e.id),
                url: str(e.html_url),
                title: str(e.tag_name ?? e.name),
                body: str(e.body),
                published: str(e.published_at),
                updated: str(e.updated_at),
                author: str(obj(e.author).login),
              },
              options.now,
            ),
          );
        return {
          items,
          fetchedCount: entries.length,
          etag: result.etag,
          lastModified: result.lastModified,
        };
      },
    },
  };
}
