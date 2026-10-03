import { z } from "zod";
import { bindingSchema, checksumSchema } from "./schema";

const text = z.string().trim().min(1).max(12000),
  name = z.string().trim().min(1).max(200),
  url = z.url().regex(/^https:\/\//);
/** Private, future-ingestion exchange. Reported lab approval is never publication authority. */
export const creativeLabHandoffSchema = z
  .strictObject({
    schema_version: z.literal(1),
    format: z.literal("creative_lab_handoff"),
    grammar_status: z.literal("PENDING_C2_CREATIVE_VALIDATION"),
    prototype: z.strictObject({
      id: name,
      revision: z.number().int().positive(),
      specification_sha256: checksumSchema,
    }),
    story_id: z.uuid().optional(),
    binding: bindingSchema.optional(),
    brief: z
      .strictObject({ id: z.uuid(), revision: z.number().int().positive() })
      .optional(),
    visual_thesis: text,
    source_assets: z
      .array(
        z.strictObject({
          id: name,
          provider: name,
          canonical_url: url.nullable(),
          creator: name.nullable(),
          license_usage_basis: text.nullable(),
          rights_status: z.enum(["unknown", "cleared", "blocked"]),
          sha256: checksumSchema.nullable(),
          private_reference: text.optional(),
        }),
      )
      .max(100),
    scenes: z
      .array(
        z.strictObject({
          id: name,
          composition_notes: text,
          source_asset_ids: z.array(name).max(100),
        }),
      )
      .max(30),
    tools_used: z
      .array(
        z.strictObject({
          name,
          version: name.optional(),
          notes: text.optional(),
        }),
      )
      .max(30),
    final_artifact: z
      .strictObject({
        design_url: url.nullable(),
        sha256: checksumSchema.nullable(),
      })
      .refine(
        (a) => a.design_url !== null || a.sha256 !== null,
        "Artifact URL or checksum required",
      ),
    daniel_feedback: z
      .array(
        z.strictObject({
          id: name,
          verbatim: text,
          recorded_at: z.iso.datetime(),
          scene_id: name.optional(),
        }),
      )
      .max(100),
    observations: z
      .array(
        z.strictObject({
          id: name,
          statement: text,
          disposition: z.enum(["approved", "rejected", "neutral"]),
          source_feedback_ids: z.array(name).min(1).max(100),
          scene_id: name.optional(),
          normalized_by: name,
          normalized_at: z.iso.datetime(),
        }),
      )
      .max(100),
    review: z.strictObject({
      decision_scope: z.literal("prototype_visual_only"),
      state: z.enum(["pending", "approved", "rejected", "changes_requested"]),
      prototype_revision: z.number().int().positive(),
      specification_sha256: checksumSchema,
      reported_reviewer: name.nullable(),
      reviewed_at: z.iso.datetime().nullable(),
      source_feedback_ids: z.array(name).max(100),
    }),
    rule_candidates: z
      .array(
        z.strictObject({
          id: name,
          statement: text,
          observation_ids: z.array(name).min(1).max(100),
          scope_notes: text,
          status: z.literal("unvalidated"),
        }),
      )
      .max(100),
    unresolved_questions: z.array(text).max(100),
    publishable: z.literal(false),
    publication_authorized: z.literal(false),
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const assets = new Set(p.source_assets.map((a) => a.id)),
      scenes = new Set(p.scenes.map((s) => s.id)),
      feedback = new Set(p.daniel_feedback.map((f) => f.id)),
      observations = new Set(p.observations.map((o) => o.id));
    for (const list of [
      p.source_assets,
      p.scenes,
      p.daniel_feedback,
      p.observations,
      p.rule_candidates,
    ])
      if (new Set(list.map((item) => item.id)).size !== list.length)
        fail("Lab IDs must be unique within each collection");
    if (p.binding && p.story_id !== p.binding.story_id)
      fail("Lab story/binding mismatch");
    if ((p.binding !== undefined) !== (p.brief !== undefined))
      fail("Exact binding and brief reference must be supplied together");
    if (
      p.review.prototype_revision !== p.prototype.revision ||
      p.review.specification_sha256 !== p.prototype.specification_sha256
    )
      fail("Review targets a different prototype iteration");
    if (
      p.review.state !== "pending" &&
      (!p.review.reported_reviewer ||
        !p.review.reviewed_at ||
        !p.review.source_feedback_ids.length)
    )
      fail(
        "Decided visual review requires recorded reviewer, time and feedback",
      );
    for (const s of p.scenes)
      if (s.source_asset_ids.some((id) => !assets.has(id)))
        fail("Lab scene asset missing");
    for (const f of [...p.daniel_feedback, ...p.observations])
      if (f.scene_id && !scenes.has(f.scene_id))
        fail("Lab feedback scene missing");
    for (const ids of [
      ...p.observations.map((o) => o.source_feedback_ids),
      p.review.source_feedback_ids,
    ])
      if (ids.some((id) => !feedback.has(id)))
        fail("Original Daniel feedback missing");
    for (const r of p.rule_candidates)
      if (r.observation_ids.some((id) => !observations.has(id)))
        fail("Rule candidate observation missing");
  });
export type CreativeLabHandoff = z.infer<typeof creativeLabHandoffSchema>;

/** A future importer must compare a trusted prototype receipt, not trust a self-declared review. */
export function validateLabHandoff(
  raw: unknown,
  expected: {
    prototype: CreativeLabHandoff["prototype"];
    binding?: CreativeLabHandoff["binding"];
    brief?: CreativeLabHandoff["brief"];
    scene_ids?: string[];
  },
) {
  const p = creativeLabHandoffSchema.parse(raw);
  if (
    p.prototype.id !== expected.prototype.id ||
    p.prototype.revision !== expected.prototype.revision ||
    p.prototype.specification_sha256 !== expected.prototype.specification_sha256
  )
    throw Error("Lab prototype receipt is stale");
  if (expected.binding) {
    for (const key of Object.keys(expected.binding) as (keyof NonNullable<
      typeof expected.binding
    >)[])
      if (p.binding?.[key] !== expected.binding[key])
        throw Error("Lab editorial binding is stale");
    if (
      !expected.brief ||
      p.brief?.id !== expected.brief.id ||
      p.brief.revision !== expected.brief.revision
    )
      throw Error("Lab brief revision is stale");
  } else if (p.binding || p.brief)
    throw Error("Bound lab exchange requires a trusted editorial receipt");
  if (
    expected.scene_ids &&
    p.scenes.some((s) => !expected.scene_ids!.includes(s.id))
  )
    throw Error("Lab scene is not in the reviewed prototype");
  return p;
}
