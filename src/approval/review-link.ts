import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sealSecret, openSecret } from "../integrations/google-oauth";
import type { Review } from "./service";
const context = "candidate-review-link/v1";
const grantSchema = z
  .object({
    candidate: z.uuid(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    owner: z.uuid(),
    nonce: z.uuid(),
    issued: z.number().int(),
    expires: z.number().int(),
  })
  .strict();
export const reviewLinkLifetime = 24 * 3600;
export const reviewCookie = (id: string) => `brainos_review_${id}`;
export function issueReviewLink(row: Review, now = Date.now()) {
  const owner = z.uuid().parse(process.env.CONTENT_OS_EDITOR_ID);
  if (row.data.state !== "AWAITING_DANIEL" || row.data.decision)
    throw Error("REVIEW_CLOSED");
  return sealSecret(
    JSON.stringify({
      candidate: row.id,
      checksum: row.data.checksum,
      owner,
      nonce: randomUUID(),
      issued: now,
      expires: now + reviewLinkLifetime * 1000,
    }),
    context,
  );
}
export function verifyReviewLink(token: string, row: Review, now = Date.now()) {
  if (!token || token.length > 3000) throw Error("Unauthorized");
  const g = grantSchema.parse(JSON.parse(openSecret(token, context)));
  if (
    g.candidate !== row.id ||
    g.checksum !== row.data.checksum ||
    g.owner !== process.env.CONTENT_OS_EDITOR_ID ||
    g.issued > now ||
    g.expires <= now ||
    g.expires - g.issued > reviewLinkLifetime * 1000 ||
    g.expires <= g.issued ||
    ["STALE", "EXPIRED"].includes(row.data.state)
  )
    throw Error("Unauthorized");
  return {
    actor: g.owner,
    expires: g.expires,
    audit: {
      method: "scoped_email_link" as const,
      grant_sha256: createHash("sha256").update(g.nonce).digest("hex"),
    },
  };
}
