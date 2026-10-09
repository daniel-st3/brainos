import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImportedPackage } from "./imported";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Evidence for one exact Reel, not an override for unresolved assets or other formats.
 * Statutory exceptions remain distinct from licenses. Daniel's exact final approval
 * is still required by the outbox and private media resolver.
 */
export function documentedReelMedia(value: ImportedPackage) {
  const b = value.publication;
  if (!b || b.kind !== "documented-instagram-reel/v1")
    throw Error("IMPORTED_REEL_BINDING_REQUIRED");
  if (
    Date.parse(b.fresh_until) <= Date.now() ||
    Date.parse(value.factual_check.checked_at) > Date.now() ||
    Date.parse(b.fresh_until) - Date.parse(value.factual_check.checked_at) >
      48 * 3600000
  )
    throw Error("IMPORTED_FACTS_REVALIDATION_REQUIRED");
  const docs = new Map(b.documents.map((d) => [d.name, d]));
  for (const name of [
    "release-rights.json",
    "release-assessment.json",
    "release-media.json",
  ]) {
    const d = docs.get(name);
    if (
      !d ||
      sha(d.utf8) !== d.sha256 ||
      !value.files.some(
        (f) =>
          f.name === name &&
          f.sha256 === d.sha256 &&
          f.bytes === Buffer.byteLength(d.utf8),
      )
    )
      throw Error("REEL_DOCUMENT_BINDING_REQUIRED");
  }
  const rights = z
    .object({
      status: z.literal("DOCUMENTED_BASIS_REQUIRES_FINAL_APPROVAL"),
      proposed_use: z.string().min(1),
      conditions: z.array(z.string().min(1)).min(1),
      assets: z
        .array(
          z.object({
            id: z.string().min(1),
            status: z.literal("BASIS_DOCUMENTED"),
            kind: z.enum([
              "owned",
              "licensed",
              "public_domain",
              "statutory_exception",
            ]),
            source: z.string().min(1),
            basis: z.string().min(1),
          }),
        )
        .min(1),
    })
    .parse(JSON.parse(docs.get("release-rights.json")!.utf8));
  const assessment = z
    .object({
      conclusion: z.literal("SUPPORTED_WITH_RESIDUAL_RISK"),
      media_sha256: z.string(),
      caption_sha256: z.string(),
      thumbnail_offset_ms: z.number().int().nonnegative(),
      purpose: z.string().min(1),
      amount: z.string().min(1),
      necessity: z.string().min(1),
      market: z.string().min(1),
      jurisdictions: z.array(z.string().min(1)).min(1),
      risks: z.array(z.string().min(1)).min(1),
      exception_assets: z.array(z.string()),
      authorities: z.array(z.string().url()).min(1),
    })
    .parse(JSON.parse(docs.get("release-assessment.json")!.utf8));
  const technical = z
    .object({
      sha256: z.string(),
      mime: z.literal("video/mp4"),
      bytes: z.number().int().positive(),
      width: z.number().int().min(320).max(1920),
      height: z.number().int().positive(),
      duration: z.number().min(5).max(900),
      codec: z.literal("h264"),
      audio_codec: z.literal("aac_lc"),
      audio_bitrate: z.number().positive().max(128000),
      thumbnail_offset_ms: z.number().int().nonnegative(),
      poster_sha256: z.string(),
      source_ids: z.array(z.string()).min(1),
    })
    .parse(JSON.parse(docs.get("release-media.json")!.utf8));
  const m = value.media[0],
    r = value.manifests.rights;
  if (
    value.media.length !== 1 ||
    !m ||
    m.mime !== technical.mime ||
    m.sha256 !== technical.sha256 ||
    m.bytes !== technical.bytes ||
    technical.width / technical.height < 9 / 16 ||
    technical.width / technical.height > 4 / 5 ||
    m.bytes > 50_000_000 ||
    technical.thumbnail_offset_ms >= technical.duration * 1000 ||
    technical.thumbnail_offset_ms !== b.thumbnail_offset_ms ||
    assessment.thumbnail_offset_ms !== b.thumbnail_offset_ms ||
    assessment.media_sha256 !== m.sha256 ||
    assessment.caption_sha256 !== value.caption_sha256 ||
    value.poster?.sha256 !== technical.poster_sha256
  )
    throw Error("EXACT_REEL_MEDIA_BINDING_REQUIRED");
  if (
    r.rights_clearance !== rights.status ||
    JSON.stringify(r.conditions) !== JSON.stringify(rights.conditions) ||
    new Set(rights.assets.map((a) => a.id)).size !== rights.assets.length ||
    r.assets.length !== rights.assets.length ||
    rights.assets.some(
      (a) =>
        !r.assets.some(
          (x) => x.id === a.id && x.status === a.status && x.basis === a.basis,
        ),
    ) ||
    technical.source_ids.length !== rights.assets.length ||
    new Set(technical.source_ids).size !== rights.assets.length ||
    technical.source_ids.some(
      (id) => !rights.assets.some((a) => a.id === id),
    ) ||
    rights.assets.some(
      (a) =>
        a.kind === "statutory_exception" &&
        !assessment.exception_assets.includes(a.id),
    )
  )
    throw Error("DOCUMENTED_REEL_RIGHTS_REQUIRED");
  return [
    {
      ...m,
      width: technical.width,
      height: technical.height,
      duration: technical.duration,
      codec: technical.codec,
      thumbnail_offset_ms: technical.thumbnail_offset_ms,
    },
  ];
}
