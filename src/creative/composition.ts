import { z } from "zod";

const id = z.uuid(),
  text = z.string().trim().min(1).max(12000),
  name = z.string().trim().min(1).max(200),
  fraction = z.number().min(0).max(1);
export const sourceReferenceSchema = z.strictObject({
  source_id: id,
  evidence_id: id.optional(),
  note: text.optional(),
});
const crop = z
  .strictObject({
    x: fraction,
    y: fraction,
    width: fraction.positive(),
    height: fraction.positive(),
  })
  .refine(
    (r) => r.x + r.width <= 1 && r.y + r.height <= 1,
    "Crop must fit the source image",
  );
/** Descriptions, not executable commands or a registry of DVNI styles. */
export const creativeOperationSchema = z.strictObject({
  id,
  operation: name,
  version: name,
  intent: text,
  input_asset_ids: z.array(id).max(100),
  output_asset_ids: z.array(id).max(100),
  depends_on: z.array(id).max(100),
  parameters: z.record(z.string().max(80), z.json()),
  sources: z.array(sourceReferenceSchema).max(30),
});
export const compositingSchema = z
  .strictObject({
    schema_version: z.literal(1),
    layers: z
      .array(
        z.strictObject({
          id,
          intent: text,
          z_index: z.number().int(),
          asset_ids: z.array(id).max(30),
          copy_key: name.optional(),
          typography_role: name.optional(),
          // Normalized canvas coordinates; negative positions/oversized frames allow intentional bleed.
          frame: z
            .strictObject({
              x: z.number(),
              y: z.number(),
              width: z.number().positive(),
              height: z.number().positive(),
              rotation_degrees: z.number().optional(),
            })
            .optional(),
          mask: z
            .strictObject({
              asset_id: id,
              mode: z.enum(["alpha", "luminance"]),
              inverted: z.boolean().optional(),
            })
            .optional(),
          transformations: z
            .array(
              z.strictObject({
                asset_id: id,
                operation: name,
                parameters: z.record(z.string().max(80), z.json()),
                focal_point: z
                  .strictObject({ x: fraction, y: fraction })
                  .optional(),
                crop: crop.optional(),
              }),
            )
            .max(30),
        }),
      )
      .max(100),
    relationships: z
      .array(
        z.strictObject({ from_layer_id: id, to_layer_id: id, intent: text }),
      )
      .max(100),
    operations: z.array(creativeOperationSchema).max(100),
  })
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const layers = new Set(c.layers.map((l) => l.id)),
      ops = new Map(c.operations.map((o) => [o.id, o]));
    if (layers.size !== c.layers.length || ops.size !== c.operations.length)
      fail("Composition IDs must be unique");
    for (const r of c.relationships)
      if (!layers.has(r.from_layer_id) || !layers.has(r.to_layer_id))
        fail("Layer relationship references a missing layer");
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) {
        fail("Creative operation dependency cycle");
        return;
      }
      if (visited.has(id)) return;
      const op = ops.get(id);
      if (!op) {
        fail("Creative operation dependency missing");
        return;
      }
      visiting.add(id);
      op.depends_on.forEach(visit);
      visiting.delete(id);
      visited.add(id);
    };
    c.operations.forEach((o) => visit(o.id));
  });

/** A derived file remains an ordinary rights-reviewed candidate with a private receipt. */
export const assetDerivationSchema = z.strictObject({
  schema_version: z.literal(1),
  operation_id: id,
  tool: z.strictObject({ name, version: name }),
  brief_id: id,
  brief_revision: z.number().int().positive(),
  content_id: id,
  content_version: z.number().int().positive(),
  draft_id: id,
  draft_revision: z.number().int().positive(),
  inputs: z
    .array(
      z.strictObject({
        asset_id: id,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(100),
});
