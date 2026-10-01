import type { Story } from "../domain/types";
import type { Discovery, SourceDefinition } from "./types";
import { canonicalize, matchesPrefix, normalizedTitle } from "./normalize";
export function primaryReferences(
  item: Discovery,
  registry: SourceDefinition[],
) {
  return [
    ...new Set(
      item.links.filter((url) =>
        registry.some(
          (s) =>
            s.tier === 0 &&
            s.primaryPrefixes.some((prefix) => matchesPrefix(url, prefix)),
        ),
      ),
    ),
  ].filter((url) => url !== item.canonicalUrl);
}
export function eventKey(item: Discovery) {
  return item.entity && item.version
    ? `${item.entity.toLowerCase()}|${item.eventKind}|${item.version.toLowerCase()}`
    : null;
}
export function matchStory(
  item: Discovery,
  stories: Story[],
): { story?: Story; reason: string } {
  const live = stories.filter((s) => !s.is_demo);
  const urls = new Set([item.canonicalUrl, ...item.primaryReferences]);
  const direct = live.filter(
    (s) =>
      s.sources.some((source) =>
        urls.has(canonicalize(source.canonical_url)),
      ) || (s.discovery?.primary_references ?? []).includes(item.canonicalUrl),
  );
  if (direct.length === 1)
    return {
      story: direct[0],
      reason: direct[0].sources.some(
        (s) => canonicalize(s.canonical_url) === item.canonicalUrl,
      )
        ? "canonical URL"
        : "referenced primary evidence",
    };
  if (direct.length > 1)
    return { reason: "ambiguous primary references; automatic merge withheld" };
  const key = eventKey(item),
    title = normalizedTitle(item.title);
  const matched = live.filter((s) => {
    const date = item.publishedAt ?? item.updatedAt;
    const previous = s.published_at ?? s.discovery?.source_updated_at;
    const nearby =
      !!date &&
      !!previous &&
      Math.abs(Date.parse(date) - Date.parse(previous)) <= 72 * 3600000;
    if (!nearby) return false;
    if (key && (s.discovery?.event_keys ?? []).includes(key)) return true;
    const specific = title.split(" ").length >= 4;
    return (
      specific &&
      (s.discovery?.normalized_titles ?? []).includes(title) &&
      !!item.entity &&
      (s.discovery?.entities ?? []).includes(item.entity)
    );
  });
  return matched.length === 1
    ? {
        story: matched[0],
        reason: key
          ? "product + event + version within 72 hours"
          : "specific title + entity within 72 hours",
      }
    : {
        reason: matched.length
          ? "ambiguous event identity; kept separate"
          : "new event",
      };
}
