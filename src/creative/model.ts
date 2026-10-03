import { creativeHash as hash } from "./fingerprint";
import {
  exactDraft,
  type Content,
  type ControlState,
  type Entity,
} from "../control/model";
import type { Story } from "../domain/types";
import {
  creativePackageSchema,
  type CreativePackage,
  type AssetCandidate,
} from "./schema";

export interface CreativeRecord extends Record<string, unknown> {
  status: "draft" | "approved" | "invalidated";
  package: CreativePackage;
  approval: { actor: string; at: string; fingerprint: string } | null;
}
export interface CreativeMedia {
  id: string;
  story_id: string;
  draft_id: string | null;
  asset_id: string | null;
  file_id: string;
  sha256: string | null;
  mime_type: string;
  created_at: string;
}
export function currentCreative(
  p: CreativePackage,
  state: ControlState,
  stories: Story[],
) {
  const content = state.entities.find(
    (e) => e.id === p.binding.content_id && e.kind === "content",
  ) as Entity<Content> | undefined;
  if (
    !content ||
    content.version !== p.binding.content_version ||
    content.story_id !== p.binding.story_id ||
    content.draft_id !== p.binding.draft_id ||
    content.data.draft_revision !== p.binding.draft_revision
  )
    throw Error("Creative content/draft binding is stale");
  const { story, draft } = exactDraft(content, stories);
  if (draft.angle_id !== p.binding.angle_id)
    throw Error("Creative approved angle mismatch");
  const sources = [
    p.brief.sources,
    ...p.captions.map((c) => c.sources),
    ...(p.carousel?.scenes.map((s) => s.sources) ?? []),
  ].flat();
  if (
    sources.some(
      (ref) =>
        !story.sources.some((s) => s.id === ref.source_id) ||
        (ref.evidence_id &&
          !story.evidence.some(
            (e) => e.id === ref.evidence_id && e.source_id === ref.source_id,
          )),
    )
  )
    throw Error("Creative evidence must reference retained story sources");
  const takes = [
    p.brief.approved_take,
    ...p.captions.map((c) => c.daniel_take),
    ...(p.carousel?.scenes.map((s) => s.approved_take) ?? []),
  ].filter((t) => t !== undefined);
  for (const ref of takes) {
    const take = state.entities.find(
      (e) => e.id === ref.id && e.kind === "take",
    );
    if (
      !take ||
      take.version !== ref.version ||
      take.data.status !== "approved" ||
      !take.data.approved_by ||
      take.data.text !== ref.text ||
      content.data.take_id !== take.id
    )
      throw Error("Exact separately approved Daniel take required");
  }
  for (const s of p.carousel?.scenes ?? [])
    if (
      s.type === "daniel_take" &&
      s.copy.daniel_take !== s.approved_take?.text
    )
      throw Error("Daniel take scene copy must equal the approved take");
  return { content, story, draft };
}
export function creativeRenderIssues(
  record: CreativeRecord,
  state: ControlState,
  stories: Story[],
  media: CreativeMedia[] = [],
) {
  const issues: string[] = [];
  let p: CreativePackage;
  try {
    p = creativePackageSchema.parse(record.package);
    currentCreative(p, state, stories);
  } catch (e) {
    return [e instanceof Error ? e.message : "Creative schema/binding invalid"];
  }
  if (
    record.status !== "approved" ||
    !record.approval?.actor ||
    record.approval.fingerprint !== hash(p)
  )
    issues.push("Exact creative specification approval required");
  if (!p.visual || !p.carousel)
    issues.push(
      "Explicit visual/carousel specification required; no default template",
    );
  if (
    p.handoffs.some(
      (h) =>
        !["CANVA_EXPORT_IMPORTED", "EXTERNAL_VISUAL_IMPORTED"].includes(
          h.state,
        ),
    )
  )
    issues.push("External visual handoff pending");
  for (const r of p.requirements.filter((r) => r.required))
    if (!p.assets.some((a) => a.requirement_id === r.id && a.selected))
      issues.push(`Required asset unresolved: ${r.id}`);
  const story = stories.find((s) => s.id === p.binding.story_id)!;
  for (const a of p.assets.filter((a) => a.selected)) {
    const authority = story.assets.find(
      (asset) => asset.id === a.authoritative_asset_id,
    );
    const receipt = media.find((m) => m.id === a.media_id);
    if (
      a.human_review !== "accepted" ||
      a.rights_status !== "cleared" ||
      !authority?.publishable ||
      authority.rights_status !== "cleared" ||
      !authority.cleared_by ||
      !authority.usage_basis ||
      !authority.cleared_at ||
      (authority.draft_id !== null &&
        authority.draft_id !== p.binding.draft_id) ||
      !story.drafts
        .find((d) => d.id === p.binding.draft_id)
        ?.asset_ids.includes(authority?.id ?? "")
    )
      issues.push(`Existing editorial rights clearance required: ${a.id}`);
    if (
      !a.sha256 ||
      !receipt ||
      receipt.sha256 !== a.sha256 ||
      receipt.asset_id !== a.authoritative_asset_id ||
      receipt.story_id !== p.binding.story_id ||
      receipt.draft_id !== p.binding.draft_id ||
      receipt.file_id !== a.file_reference ||
      receipt.mime_type !== a.mime
    )
      issues.push(
        `Verified current media checksum/provenance required: ${a.id}`,
      );
  }
  return issues;
}
/** Metadata from an existing private upload receipt; never trusts a caller-supplied checksum. */
export function importedCandidate(
  p: CreativePackage,
  handoffId: string,
  receipt: CreativeMedia,
  metadata: {
    requirement_id: string;
    generated_at: string | null;
    rights_usage_notes: string;
  },
  now: string,
): AssetCandidate {
  const h = p.handoffs.find((h) => h.id === handoffId);
  if (
    !h ||
    h.brief_id !== p.brief.id ||
    h.brief_revision !== p.brief.revision ||
    !receipt.sha256 ||
    receipt.story_id !== p.binding.story_id ||
    receipt.draft_id !== p.binding.draft_id
  )
    throw Error("Current handoff and exact uploaded media revision required");
  if (h.requirement_id && h.requirement_id !== metadata.requirement_id)
    throw Error("Handoff asset requirement mismatch");
  return {
    id: crypto.randomUUID(),
    requirement_id: metadata.requirement_id,
    provider: h.provider,
    canonical_source_url: null,
    creator:
      h.provider === "chatgpt_manual" ? "ChatGPT manual" : "Canva manual",
    usage_basis: metadata.rights_usage_notes,
    license: null,
    attribution: "Human-selected external visual; rights review required",
    retrieved_at: now,
    mime: receipt.mime_type,
    width: null,
    height: null,
    duration: null,
    sha256: receipt.sha256,
    relevance: h.request,
    selected: true,
    human_review: "pending",
    rights_status: "unknown",
    publishable: false,
    authoritative_asset_id: receipt.asset_id,
    media_id: receipt.id,
    file_reference: receipt.file_id,
    import_provenance: {
      creator_source:
        h.provider === "chatgpt_manual" ? "ChatGPT manual" : "Canva manual",
      brief_id: p.brief.id,
      brief_revision: p.brief.revision,
      prompt_reference: h.prompt_reference,
      generated_at: metadata.generated_at,
      imported_at: now,
      sha256: receipt.sha256,
      rights_usage_notes: metadata.rights_usage_notes,
      human_selected: true,
      binding: p.binding,
    },
    extensions: {},
  };
}
