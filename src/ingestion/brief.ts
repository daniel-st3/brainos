import type { Story } from "../domain/types";
import { strongestSource } from "./provenance";
export function selectBrief(
  stories: Story[],
  now = new Date().toISOString(),
  limit = 10,
) {
  const age = (s: Story) =>
    (Date.parse(now) -
      Date.parse(
        s.published_at ?? s.discovery?.source_updated_at ?? s.discovered_at,
      )) /
    86400000;
  const score = (s: Story) =>
    (s.priority ? 100 : 0) +
    (s.discovery?.scoring?.total ?? 0) +
    Math.max(0, 3 - age(s));
  const candidates = stories.filter(
    (s) =>
      !s.is_demo &&
      !s.archived &&
      ["detected", "verified", "researched", "angle_ready"].includes(
        s.status,
      ) &&
      (s.priority || age(s) <= 14),
  );
  candidates.sort(
    (a, b) =>
      score(b) - score(a) ||
      b.discovered_at.localeCompare(a.discovered_at) ||
      a.id.localeCompare(b.id),
  );
  const counts = new Map<string, number>();
  return candidates
    .filter((s) => {
      const publisher = strongestSource(s)?.publisher ?? "unknown";
      const n = counts.get(publisher) ?? 0;
      if (n >= 3 && !s.priority) return false;
      counts.set(publisher, n + 1);
      return true;
    })
    .slice(0, limit);
}
