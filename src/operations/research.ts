import { createHash } from "node:crypto";
import type { Story } from "../domain/types";
import { strongestSource } from "../ingestion/provenance";
export function evidenceFingerprint(story: Story) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        story.sources.map((s) => [s.id, s.canonical_url, s.excerpt]).sort(),
      ),
    )
    .digest("hex");
}
/** Evidence-linked extraction, not factual verification or an LLM result. */
export function researchPacket(story: Story) {
  const source = strongestSource(story);
  return {
    label: "System-generated research aid · human verification required",
    provider: "deterministic-evidence/v1",
    summary: source?.excerpt.slice(0, 1200) ?? story.summary,
    primary_source_id: source?.is_primary ? source.id : null,
    evidence_status: source?.is_primary
      ? "primary_found_unverified"
      : "primary_unresolved",
    candidate_claims: story.sources
      .filter((s) => s.excerpt.trim())
      .map((s) => ({
        text: s.excerpt.slice(0, 700),
        source_id: s.id,
        url: s.canonical_url,
        locator: "Feed excerpt",
        verification_status: "unverified",
      })),
    suggestions: [
      {
        kind: "fast_news",
        text: `What changed in ${story.title}?`,
        confirmed_opinion: false,
      },
      {
        kind: "opinion",
        text: "Which tradeoff matters to a working builder? Daniel must choose and confirm his take.",
        confirmed_opinion: false,
      },
      {
        kind: "practical",
        text: "Design one small reproducible test; record costs, limitations and a baseline.",
        confirmed_opinion: false,
      },
    ],
    limitations: [
      "Feed excerpts may be incomplete. Open the original evidence.",
      "No claim verification, regional availability or personal opinion inferred.",
    ],
  };
}
