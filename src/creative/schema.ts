import { z } from "zod";
import {
  compositingSchema,
  assetDerivationSchema,
  sourceReferenceSchema,
} from "./composition";
export { sourceReferenceSchema } from "./composition";

const id = z.uuid(),
  text = z.string().trim().min(1).max(12000);
const revision = z.number().int().positive();
export const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const url = z.url().regex(/^https:\/\//);
const extensions = z.record(z.string().max(80), z.json()).default({});
export const bindingSchema = z.strictObject({
  story_id: id,
  content_id: id,
  content_version: revision,
  angle_id: id,
  draft_id: id,
  draft_revision: revision,
});
const typographySchema = z
  .array(
    z.strictObject({
      role: z.string().min(1).max(80),
      direction: text,
      family: z.string().max(200).optional(),
      weight: z.number().int().min(100).max(900).optional(),
    }),
  )
  .max(20);
export const paletteSchema = z.strictObject({
  direction: text.optional(),
  composition: z.enum(["light", "dark", "mixed", "unspecified"]).optional(),
  colors: z
    .array(
      z.strictObject({
        role: z.string().min(1).max(80),
        value: z.string().regex(/^#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?$/),
      }),
    )
    .max(30),
});
export const visualSpecSchema = z.strictObject({
  schema_version: z.literal(1),
  visual_thesis: text,
  composition: text,
  typography: typographySchema,
  palette: paletteSchema.optional(),
  image_treatment: text.optional(),
  layering: z.array(text).max(30).default([]),
  masks_crops: z.array(text).max(30).default([]),
  source_treatment: text.optional(),
  motion_notes: text.optional(),
  aspect_ratios: z
    .array(z.string().regex(/^\d{1,4}:\d{1,4}$/))
    .min(1)
    .max(10),
  rights_requirements: z.array(text).max(30).default([]),
  fallback_strategy: text,
  extensions,
});
export const sceneTypes = [
  "hero",
  "news",
  "photo",
  "evidence",
  "source",
  "quote",
  "stat",
  "data",
  "chart",
  "diagram",
  "timeline",
  "product_ui",
  "screenshot",
  "comparison",
  "explainer",
  "daniel_take",
  "what_next",
  "cta",
  "custom",
] as const;
export const takeReferenceSchema = z.strictObject({
  id,
  version: revision,
  text,
});
export const carouselSceneSchema = z
  .strictObject({
    id,
    type: z.enum(sceneTypes),
    copy: z.record(z.string().max(80), z.string().max(12000)),
    hierarchy: z.array(z.string().max(80)).max(30),
    composition: text,
    compositing: compositingSchema.optional(),
    asset_ids: z.array(id).max(30),
    typography: typographySchema,
    palette: paletteSchema.optional(),
    motion_equivalent: text.optional(),
    sources: z.array(sourceReferenceSchema).max(30),
    approved_take: takeReferenceSchema.optional(),
    extensions,
  })
  .superRefine((s, ctx) => {
    if (s.type === "daniel_take" && !s.approved_take)
      ctx.addIssue({
        code: "custom",
        message: "Daniel take scene requires an approved take reference",
      });
  });
export const carouselSpecSchema = z
  .strictObject({
    schema_version: z.literal(1),
    aspect_ratio: z.string().regex(/^\d{1,4}:\d{1,4}$/),
    scenes: z.array(carouselSceneSchema).min(1).max(30),
    extensions,
  })
  .superRefine((s, ctx) => {
    if (new Set(s.scenes.map((x) => x.id)).size !== s.scenes.length)
      ctx.addIssue({
        code: "custom",
        message: "Scene IDs must be unique; array order is scene order",
      });
  });
export const captionPlatforms = [
  "instagram",
  "tiktok",
  "youtube_shorts",
  "x",
  "newsletter",
] as const;
export const captionSpecSchema = z.strictObject({
  schema_version: z.literal(1),
  platform: z.enum(captionPlatforms),
  language: z.string().min(2).max(20),
  hook: z.string().max(2000),
  body: z.string().max(12000),
  context: z.string().max(5000),
  daniel_take: takeReferenceSchema.optional(),
  cta: z.string().max(2000),
  source_note: z.string().max(5000),
  sources: z.array(sourceReferenceSchema).max(30),
  hashtags: z.array(z.string().max(100)).max(50),
  alt_text: z.string().max(5000),
  title: z.string().max(500).optional(),
  description: z.string().max(12000).optional(),
  extensions,
});
export const motionSpecSchema = z.strictObject({
  schema_version: z.literal(1),
  fps: z.number().int().min(1).max(120),
  scenes: z
    .array(
      z.strictObject({
        scene_id: id,
        duration_seconds: z.number().positive().max(3600),
        direction: text,
        transition: text.optional(),
        reduced_motion_alternative: text,
      }),
    )
    .min(1)
    .max(30),
  extensions,
});
export const assetRequirementSchema = z.strictObject({
  id,
  description: text,
  required: z.boolean(),
  scene_ids: z.array(id).max(30),
  usage: text,
  rights_requirements: z.array(text).max(30),
  fallback_strategy: text,
});
export const assetProviders = [
  "daniel_owned",
  "official_media",
  "screenshot",
  "wikimedia",
  "pexels",
  "manual_upload",
  "chatgpt_manual",
  "canva_manual",
  "future",
] as const;
export const assetCandidateSchema = z.strictObject({
  id,
  requirement_id: id,
  provider: z.enum(assetProviders),
  provider_name: z.string().max(200).optional(),
  derivation: assetDerivationSchema.optional(),
  canonical_source_url: url.nullable(),
  creator: z.string().max(500).nullable(),
  usage_basis: z.string().max(5000),
  license: z.string().max(2000).nullable(),
  attribution: z.string().max(5000),
  retrieved_at: z.iso.datetime(),
  mime: z.string().min(1).max(120),
  width: revision.nullable(),
  height: revision.nullable(),
  duration: z.number().nonnegative().nullable(),
  sha256: checksumSchema.nullable(),
  relevance: text,
  selected: z.boolean(),
  human_review: z.enum(["pending", "accepted", "rejected"]),
  rights_status: z.enum(["unknown", "cleared", "blocked"]),
  publishable: z.literal(false),
  authoritative_asset_id: id.nullable(),
  media_id: id.nullable(),
  file_reference: z.string().max(2000).nullable(),
  import_provenance: z
    .strictObject({
      creator_source: z.enum(["ChatGPT manual", "Canva manual"]),
      brief_id: id,
      brief_revision: revision,
      prompt_reference: z.string().max(12000).nullable(),
      generated_at: z.iso.datetime().nullable(),
      imported_at: z.iso.datetime(),
      sha256: checksumSchema,
      rights_usage_notes: text,
      human_selected: z.literal(true),
      binding: bindingSchema,
    })
    .optional(),
  extensions,
});
export const creativeBriefSchema = z.strictObject({
  schema_version: z.literal(1),
  id,
  revision,
  objective: text,
  audience: text,
  thesis: text,
  exact_copy: z.record(z.string().max(80), z.string().max(12000)),
  sources: z.array(sourceReferenceSchema).max(50),
  approved_take: takeReferenceSchema.optional(),
  art_direction: z.string().max(12000).optional(),
  extensions,
});
export const handoffSchema = z.strictObject({
  id,
  provider: z.enum(["chatgpt_manual", "canva_manual"]),
  brief_id: id,
  brief_revision: revision,
  requirement_id: id.optional(),
  request: text,
  prompt_reference: z.string().max(12000).nullable(),
  state: z.enum([
    "WAITING_FOR_EXTERNAL_VISUAL",
    "CANVA_HANDOFF_READY",
    "CANVA_EDITING",
    "CANVA_EXPORT_IMPORTED",
    "EXTERNAL_VISUAL_IMPORTED",
  ]),
  requested_at: z.iso.datetime(),
  candidate_id: id.nullable(),
});
export const creativePackageSchema = z
  .strictObject({
    schema_version: z.literal(1),
    grammar_status: z.literal("PENDING_C2_CREATIVE_VALIDATION"),
    binding: bindingSchema,
    brief: creativeBriefSchema,
    visual: visualSpecSchema.optional(),
    carousel: carouselSpecSchema.optional(),
    captions: z.array(captionSpecSchema).max(5),
    motion: motionSpecSchema.optional(),
    requirements: z.array(assetRequirementSchema).max(100),
    assets: z.array(assetCandidateSchema).max(100),
    handoffs: z.array(handoffSchema).max(50),
    extensions,
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const list of [p.requirements, p.assets, p.handoffs])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        fail("Duplicate creative record IDs");
    if (new Set(p.captions.map((x) => x.platform)).size !== p.captions.length)
      fail("Store one independent caption per platform");
    const scenes = new Set(p.carousel?.scenes.map((x) => x.id) ?? []);
    for (const r of p.requirements)
      if (r.scene_ids.some((id) => !scenes.has(id)))
        fail("Asset requirement references a missing scene");
    for (const a of p.assets) {
      if (!p.requirements.some((r) => r.id === a.requirement_id))
        fail("Asset requirement missing");
      if (
        a.import_provenance &&
        (a.import_provenance.brief_id !== p.brief.id ||
          a.import_provenance.brief_revision !== p.brief.revision ||
          JSON.stringify(a.import_provenance.binding) !==
            JSON.stringify(p.binding) ||
          a.import_provenance.sha256 !== a.sha256)
      )
        fail("External asset binding/checksum is stale");
    }
    for (const s of p.carousel?.scenes ?? [])
      if (s.asset_ids.some((id) => !p.assets.some((a) => a.id === id)))
        fail("Scene asset missing");
    const assets = new Map(p.assets.map((a) => [a.id, a]));
    const operations = (p.carousel?.scenes ?? []).flatMap(
      (s) => s.compositing?.operations ?? [],
    );
    if (new Set(operations.map((o) => o.id)).size !== operations.length)
      fail("Operation IDs must be unique across scenes");
    const outputs = operations.flatMap((o) => o.output_asset_ids);
    if (new Set(outputs).size !== outputs.length)
      fail("Each intermediate asset must have one producer operation");
    for (const s of p.carousel?.scenes ?? []) {
      for (const l of s.compositing?.layers ?? []) {
        const refs = [
          ...l.asset_ids,
          ...l.transformations.map((t) => t.asset_id),
          ...(l.mask ? [l.mask.asset_id] : []),
        ];
        if (refs.some((id) => !s.asset_ids.includes(id)))
          fail("Layer assets must be declared in the scene");
        if (l.copy_key && !Object.hasOwn(s.copy, l.copy_key))
          fail("Layer copy key missing");
        if (
          l.typography_role &&
          !s.typography.some((t) => t.role === l.typography_role)
        )
          fail("Layer typography role missing");
      }
      for (const o of s.compositing?.operations ?? [])
        if (
          [...o.input_asset_ids, ...o.output_asset_ids].some(
            (id) => !s.asset_ids.includes(id),
          )
        )
          fail("Operation assets must be declared in the scene");
    }
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visitAsset = (id: string): void => {
      if (visiting.has(id)) {
        fail("Derived asset dependency cycle");
        return;
      }
      if (visited.has(id)) return;
      const a = assets.get(id);
      if (!a) {
        fail("Derived asset input missing");
        return;
      }
      visiting.add(id);
      if (a.derivation) {
        const d = a.derivation,
          op = operations.find((o) => o.id === d.operation_id);
        if (
          d.brief_id !== p.brief.id ||
          d.brief_revision !== p.brief.revision ||
          d.content_id !== p.binding.content_id ||
          d.content_version !== p.binding.content_version ||
          d.draft_id !== p.binding.draft_id ||
          d.draft_revision !== p.binding.draft_revision
        )
          fail("Derived asset revision binding is stale");
        if (
          !op ||
          !op.output_asset_ids.includes(a.id) ||
          new Set(d.inputs.map((i) => i.asset_id)).size !== d.inputs.length ||
          op.input_asset_ids.length !== d.inputs.length ||
          d.inputs.some((i) => !op.input_asset_ids.includes(i.asset_id))
        )
          fail("Derived asset operation provenance mismatch");
        for (const i of d.inputs) {
          if (assets.get(i.asset_id)?.sha256 !== i.sha256)
            fail("Derived asset input checksum is stale");
          visitAsset(i.asset_id);
        }
      }
      visiting.delete(id);
      visited.add(id);
    };
    p.assets.forEach((a) => visitAsset(a.id));
    for (const m of p.motion?.scenes ?? [])
      if (!scenes.has(m.scene_id))
        fail("Motion must reference the same carousel scenes");
    for (const h of p.handoffs) {
      if (h.brief_id !== p.brief.id || h.brief_revision !== p.brief.revision)
        fail("Handoff brief revision mismatch");
      if (
        h.requirement_id &&
        !p.requirements.some((r) => r.id === h.requirement_id)
      )
        fail("Handoff requirement missing");
      if (h.candidate_id && !p.assets.some((a) => a.id === h.candidate_id))
        fail("Handoff imported asset missing");
    }
  });
export type CreativePackage = z.infer<typeof creativePackageSchema>;
export type AssetCandidate = z.infer<typeof assetCandidateSchema>;
export type CaptionSpec = z.infer<typeof captionSpecSchema>;
export type VisualSpec = z.infer<typeof visualSpecSchema>;
export const creativeOperations = [
  "GENERATE_CREATIVE_BRIEF",
  "GENERATE_VISUAL_SPEC",
  "GENERATE_CAROUSEL_SPEC",
  "GENERATE_CAPTION_SPEC",
  "GENERATE_MOTION_SPEC",
  "RESOLVE_ASSET_CANDIDATES",
  "WAIT_FOR_EXTERNAL_VISUAL",
  "IMPORT_EXTERNAL_VISUAL",
  "RENDER_STATIC_CREATIVE",
  "RENDER_MOTION_CREATIVE",
] as const;
