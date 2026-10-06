/** Exact external packages may enter private review without acquiring publish authority. */
import { createHash } from "node:crypto";
import { z } from "zod";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({
  file_id: z.string().min(1),
  sha256: sha,
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  name: z.string().min(1),
});
export const importedPackageSchema = z.object({
  schema: z.literal("external-publication-package/v1"),
  revision: z.string().min(1),
  archive: file,
  caption_sha256: sha,
  media: z
    .array(
      file.extend({ mime: z.enum(["video/mp4", "image/png", "image/jpeg"]) }),
    )
    .min(1)
    .max(10),
  poster: file.extend({ mime: z.literal("image/png") }).optional(),
  files: z.array(file).min(1).max(100),
  manifests: z.object({
    rights: z
      .object({
        overall_risk: z.string(),
        rights_clearance: z.string(),
        assets: z.array(
          z
            .object({ id: z.string(), status: z.string(), basis: z.string() })
            .passthrough(),
        ),
      })
      .passthrough(),
    sources: z.record(z.string(), z.unknown()),
    claims: z.record(z.string(), z.unknown()),
    asset_manifest: z.record(z.string(), z.unknown()),
    checksums: z.record(z.string(), z.unknown()),
    production_notes: z.record(z.string(), z.unknown()),
  }),
  factual_check: z.object({
    checked_at: z.iso.datetime(),
    source_url: z.url(),
    price: z.string(),
    availability: z.string(),
    shipping: z.string(),
  }),
});
export type ImportedPackage = z.infer<typeof importedPackageSchema>;
export function validateImportedPackage(
  raw: unknown,
  packageId: string,
  caption: string,
) {
  const value = importedPackageSchema.parse(raw);
  if (
    createHash("sha256").update(caption, "utf8").digest("hex") !==
    value.caption_sha256
  )
    throw Error("EXACT_CAPTION_REQUIRED");
  for (const f of [
    value.archive,
    ...value.files,
    ...value.media,
    ...(value.poster ? [value.poster] : []),
  ])
    if (
      !f.file_id.startsWith(`${packageId}/external/`) ||
      f.file_id.includes("..") ||
      f.file_id.includes("\\")
    )
      throw Error("PACKAGE_MEDIA_BINDING_REQUIRED");
  for (const f of [...value.media, ...(value.poster ? [value.poster] : [])])
    if (
      !value.files.some(
        (x) =>
          x.file_id === f.file_id &&
          x.sha256 === f.sha256 &&
          x.bytes === f.bytes &&
          x.mime === f.mime,
      )
    )
      throw Error("PACKAGE_MEDIA_BINDING_REQUIRED");
  return value;
}
export function importedPublicationBlockers(
  value: ImportedPackage,
  adapter: string,
) {
  const blockers = [
    "External package is available for review only; automated publication of these original files is not enabled.",
  ];
  if (
    value.manifests.rights.rights_clearance !== "CLEARED" ||
    value.manifests.rights.assets.some((a) => a.status !== "CLEARED")
  )
    blockers.push(
      "Manufacturer media rights remain UNCLEAR. Daniel’s creative approval does not clear reuse rights.",
    );
  if (
    adapter === "buffer" &&
    value.media.some((m) => m.mime.startsWith("video/")) &&
    value.media.some((m) => m.mime.startsWith("image/"))
  )
    blockers.push(
      "Buffer accepts mixed image/video carousel drafts. This imported package still requires an approved publication binding and cleared rights before automated delivery.",
    );
  return blockers;
}
