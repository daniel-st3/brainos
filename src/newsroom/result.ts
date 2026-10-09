import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const newsroomResult = z
  .object({
    title: z.string().min(1).max(200),
    caption: z.string().min(1).max(2200),
    source_url: z.url(),
    source_sha256: hash,
    source_excerpt: z.string().min(100).max(40000),
    source_retrieved_at: z.iso.datetime(),
    claims: z
      .array(
        z.object({
          text: z.string().max(600),
          evidence_quote: z.string().min(10).max(1000),
        }),
      )
      .min(2)
      .max(8),
    angle: z.string().max(1000),
    visual_thesis: z.string().max(1500),
    assets: z
      .array(
        z.object({
          url: z.url(),
          sha256: hash,
          rights: z.literal("UNCLEAR"),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(5),
    media: z
      .array(
        z.object({
          name: z.string().regex(/^0[1-4]\.png$/),
          sha256: hash,
          bytes: z.number().int().positive().max(15000000),
          width: z.literal(1080),
          height: z.literal(1350),
          file_id: z.string(),
        }),
      )
      .min(3)
      .max(4),
    qa: z.object({
      pass: z.literal(true),
      findings: z.array(z.string()).max(30),
      limitations: z.array(z.string()).max(20),
    }),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();
export function validateNewsroomResult(raw: unknown, packageId: string) {
  const r = newsroomResult.parse(raw),
    words = r.caption.trim().split(/\s+/).length;
  if (words < 40 || words > 80) throw Error("CAPTION_LENGTH");
  const plain = (s: string) => s.replace(/\s+/g, " ").trim();
  if (
    r.claims.some(
      (c) => !plain(r.source_excerpt).includes(plain(c.evidence_quote)),
    )
  )
    throw Error("UNSUPPORTED_CLAIM_QUOTE");
  if (
    r.media.some(
      (m, i) =>
        m.name !== `0${i + 1}.png` ||
        m.file_id !== `${packageId}/external/${m.sha256}/${m.name}`,
    )
  )
    throw Error("MEDIA_ORDER_OR_SCOPE");
  if (
    Date.parse(r.source_retrieved_at) > Date.now() ||
    Date.now() - Date.parse(r.source_retrieved_at) > 3600000
  )
    throw Error("STALE_RESEARCH");
  return r;
}
