import { creativeHash as hash } from "./fingerprint";
import { type ControlState, type Entity } from "../control/model";
import type { Story } from "../domain/types";
import { currentCreative, type CreativeRecord } from "./model";
export function canvaHandoff(
  record: Entity<CreativeRecord>,
  state: ControlState,
  stories: Story[],
) {
  const p = record.data.package;
  currentCreative(p, state, stories);
  if (!p.carousel || !p.visual)
    throw Error("Explicit scene order and visual instructions required");
  return {
    schema_version: 1,
    format: "manual_canva_handoff",
    grammar_status: "PENDING_C2_CREATIVE_VALIDATION",
    creative_id: record.id,
    creative_version: record.version,
    brief_id: p.brief.id,
    brief_revision: p.brief.revision,
    specification_sha256: hash(p),
    binding: p.binding,
    brief: p.brief,
    scene_order: p.carousel.scenes.map((s) => s.id),
    scenes: p.carousel.scenes,
    aspect_ratio: p.carousel.aspect_ratio,
    visual: p.visual,
    captions: p.captions,
    selected_assets: p.assets
      .filter((a) => a.selected)
      .map((a) => ({
        id: a.id,
        provider: a.provider,
        source_url: a.canonical_source_url,
        private_file_reference: a.file_reference,
        media_id: a.media_id,
        sha256: a.sha256,
        attribution: a.attribution,
        usage_basis: a.usage_basis,
        rights_status: a.rights_status,
        human_review: a.human_review,
        ...(a.derivation ? { derivation: a.derivation } : {}),
        publishable: false,
      })),
    sources: stories
      .find((s) => s.id === p.binding.story_id)!
      .sources.filter((s) =>
        [
          p.brief.sources,
          ...p.carousel!.scenes.map((s) => s.sources),
          ...p.carousel!.scenes.flatMap(
            (s) => s.compositing?.operations.map((o) => o.sources) ?? [],
          ),
          ...p.captions.map((c) => c.sources),
        ]
          .flat()
          .some((r) => r.source_id === s.id),
      )
      .map((s) => ({
        id: s.id,
        url: s.canonical_url,
        publisher: s.publisher,
        excerpt: s.excerpt,
      })),
    review_required: true,
    publishable: false,
  };
}
