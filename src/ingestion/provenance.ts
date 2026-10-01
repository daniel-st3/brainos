import type { Source, Story } from "../domain/types";
export function strongestSource(story: Story): Source | undefined {
  return (
    story.sources.find((s) => s.id === story.discovery?.strongest_source_id) ??
    story.sources.find((s) => s.is_primary && s.tier === "primary") ??
    story.sources[0]
  );
}
export function evidenceTier(source?: Source) {
  return source?.is_primary && source.tier === "primary"
    ? "Tier 0 · Primary"
    : source?.tier === "journalism"
      ? "Tier 1 · Reporting"
      : "Tier 2 · Discovery";
}
export function orderSources(story: Story) {
  const best = strongestSource(story);
  return {
    ...story,
    sources: [...story.sources].sort((a, b) =>
      a.id === best?.id ? -1 : b.id === best?.id ? 1 : 0,
    ),
  };
}
