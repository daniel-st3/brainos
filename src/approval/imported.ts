/** Exact external packages may enter private review without acquiring publish authority. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { neoOwnerMedia } from "./neo-publication";
import { documentedReelMedia } from "./reel-publication";
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
  publication: z
    .object({
      kind: z.enum([
        "licensed-image-carousel/v1",
        "neo-owner-risk-carousel/v1",
        "documented-instagram-reel/v1",
      ]),
      thumbnail_offset_ms: z.number().int().nonnegative().optional(),
      platform: z.literal("instagram"),
      fresh_until: z.iso.datetime(),
      documents: z
        .array(
          z.object({ name: z.string(), sha256: sha, utf8: z.string().min(1) }),
        )
        .length(3),
    })
    .optional(),
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
    claims: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    asset_manifest: z.union([
      z.record(z.string(), z.unknown()),
      z.array(z.unknown()),
    ]),
    checksums: z.record(z.string(), z.unknown()),
    production_notes: z.record(z.string(), z.unknown()),
  }),
  factual_check: z.object({
    checked_at: z.iso.datetime(),
    source_url: z.url(),
    price: z.string().optional(),
    availability: z.string().optional(),
    shipping: z.string().optional(),
    checks: z.record(z.string(), z.string()).optional(),
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
  if (value.publication) {
    try {
      publicationMedia(value);
    } catch {
      return [
        "Publication binding is invalid or stale; prepare a new reviewed revision.",
      ];
    }
    return ["buffer", "simulator"].includes(adapter)
      ? []
      : ["Verified Buffer Instagram connection required."];
  }
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

/** Only an evidence-backed, licensed image package can leave private review.
 * This does not clear rights: all source assets must already be CLEARED, with
 * their original rights, license and ordered manifest bytes bound to the import.
 */
export function licensedImageMedia(value: ImportedPackage) {
  const binding = value.publication;
  if (
    !binding ||
    binding.kind !== "licensed-image-carousel/v1" ||
    binding.platform !== "instagram"
  )
    throw Error("IMPORTED_PACKAGE_REVIEW_ONLY");
  if (
    Date.parse(binding.fresh_until) <= Date.now() ||
    Date.parse(value.factual_check.checked_at) > Date.now() ||
    Date.parse(binding.fresh_until) -
      Date.parse(value.factual_check.checked_at) >
      48 * 3600000
  )
    throw Error("IMPORTED_FACTS_REVALIDATION_REQUIRED");
  const documents = new Map(binding.documents.map((d) => [d.name, d]));
  for (const name of ["rights.json", "LICENSE.txt", "asset-manifest.json"]) {
    const d = documents.get(name);
    if (
      !d ||
      createHash("sha256").update(d.utf8, "utf8").digest("hex") !== d.sha256 ||
      !value.files.some(
        (f) =>
          f.name === name &&
          f.sha256 === d.sha256 &&
          f.bytes === Buffer.byteLength(d.utf8),
      )
    )
      throw Error("LICENSE_DOCUMENT_BINDING_REQUIRED");
  }
  const rights = z
    .object({
      status: z.literal("CLEARED FOR PROPOSED DVNI USE"),
      proposed_use: z.string().min(1),
      conditions: z.array(z.string().min(1)).min(1),
      assets: z
        .array(
          z.object({
            id: z.string(),
            status: z.literal("CLEARED"),
            source: z.url(),
            license: z.string().min(1),
            license_url: z.url(),
            permission_basis: z.string().min(1),
          }),
        )
        .min(1),
    })
    .parse(JSON.parse(documents.get("rights.json")!.utf8));
  if (
    value.manifests.rights.rights_clearance !== "CLEARED" ||
    value.manifests.rights.assets.length !== rights.assets.length ||
    rights.assets.some(
      (a) =>
        !value.manifests.rights.assets.some(
          (b) =>
            b.id === a.id &&
            b.status === "CLEARED" &&
            b.basis === a.permission_basis,
        ),
    )
  )
    throw Error("CLEARED_SOURCE_RIGHTS_REQUIRED");
  const manifest = z
    .array(
      z
        .object({
          path: z.string(),
          sha256: sha,
          bytes: z.number().int().positive(),
          order: z.number().int().optional(),
          dimensions: z
            .tuple([z.number().int().positive(), z.number().int().positive()])
            .optional(),
          media_type: z.string().optional(),
          source_ids: z.array(z.string()).optional(),
          rights_status: z.string().optional(),
        })
        .passthrough(),
    )
    .parse(JSON.parse(documents.get("asset-manifest.json")!.utf8));
  const ordered = manifest
    .filter((f) => f.order !== undefined)
    .sort((a, b) => a.order! - b.order!);
  if (
    ordered.length !== value.media.length ||
    ordered.length < 2 ||
    ordered.length > 10
  )
    throw Error("EXACT_IMAGE_ORDER_REQUIRED");
  return value.media.map((m, i) => {
    const f = ordered[i];
    if (
      f.order !== i + 1 ||
      f.path !== m.name ||
      f.sha256 !== m.sha256 ||
      f.bytes !== m.bytes ||
      f.media_type !== m.mime ||
      !["image/png", "image/jpeg"].includes(m.mime) ||
      f.rights_status !== "CLEARED" ||
      !f.dimensions ||
      !f.source_ids?.length ||
      f.source_ids.some((id) => !rights.assets.some((a) => a.id === id))
    )
      throw Error("EXACT_LICENSED_IMAGE_BINDING_REQUIRED");
    return { ...m, width: f.dimensions[0], height: f.dimensions[1] };
  });
}

export function publicationMedia(value: ImportedPackage): (ReturnType<
  typeof licensedImageMedia
>[number] & {
  duration?: number;
  codec?: string;
  thumbnail_offset_ms?: number;
})[] {
  if (value.publication?.kind === "neo-owner-risk-carousel/v1")
    return neoOwnerMedia(value);
  return value.publication?.kind === "documented-instagram-reel/v1"
    ? documentedReelMedia(value)
    : licensedImageMedia(value);
}
