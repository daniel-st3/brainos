import { createHash } from "node:crypto";
import type { ImportedPackage } from "./imported";
import type { Candidate } from "./model";
import { neoPolicy as policy } from "./neo-policy";
const stable = (v: unknown): string =>
  JSON.stringify(v, (_key, x) =>
    x && !Array.isArray(x) && typeof x === "object"
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const isNeoRisk = (im?: ImportedPackage) =>
  im?.publication?.kind === policy.kind;
export function neoOwnerMedia(im: ImportedPackage) {
  const b = im.publication,
    r = im.manifests.rights;
  if (
    !isNeoRisk(im) ||
    !b ||
    im.revision !== "NEO-OWNER-RISK-1" ||
    im.caption_sha256 !== policy.caption_sha256 ||
    im.poster ||
    r.rights_clearance !== "UNCLEAR" ||
    r.assets.length !== 1 ||
    r.assets[0].id !== "1x-photography" ||
    r.assets[0].status !== "UNCLEAR" ||
    im.media.length !== 4
  )
    throw Error("NEO_EXACT_SCOPE_REQUIRED");
  const checked = Date.parse(im.factual_check.checked_at),
    fresh = Date.parse(b.fresh_until);
  if (
    !Number.isFinite(checked) ||
    !Number.isFinite(fresh) ||
    checked > Date.now() ||
    fresh <= Date.now() ||
    fresh - checked > 48 * 3600000
  )
    throw Error("IMPORTED_FACTS_REVALIDATION_REQUIRED");
  for (const name of ["owner-risk.json", "rights.json", "manifest.json"]) {
    const d = b.documents.find((d) => d.name === name);
    if (
      !d ||
      sha(d.utf8) !== d.sha256 ||
      !im.files.some(
        (f) =>
          f.name === name &&
          f.sha256 === d.sha256 &&
          f.bytes === Buffer.byteLength(d.utf8),
      )
    )
      throw Error("NEO_RISK_DOCUMENT_REQUIRED");
  }
  const risk = JSON.parse(
    b.documents.find((d) => d.name === "owner-risk.json")!.utf8,
  );
  if (
    stable(risk) !== stable(policy) ||
    r.disclosure !== policy.disclosure ||
    r.acknowledgment !== policy.acknowledgment
  )
    throw Error("NEO_RISK_DISCLOSURE_REQUIRED");
  // Original rights/provenance remain bound, without relabelling them as permission.
  const original = JSON.parse(
    b.documents.find((d) => d.name === "rights.json")!.utf8,
  );
  if (
    stable(original) !== stable(r.original_record) ||
    original.cover_use_permission !== "NOT_OBTAINED"
  )
    throw Error("NEO_ORIGINAL_RIGHTS_REQUIRED");
  return im.media.map((m, i) => {
    const expected = policy.media[i];
    if (
      m.name !== expected.name ||
      m.sha256 !== expected.sha256 ||
      m.bytes !== expected.bytes ||
      m.mime !== "image/png" ||
      !m.file_id.startsWith(`${policy.package_id}/external/`)
    )
      throw Error("NEO_EXACT_MEDIA_REQUIRED");
    return { ...m, width: 1080, height: 1350 };
  });
}
export function assertNeoScope(f: Candidate["frozen"]) {
  if (!isNeoRisk(f.imported)) return;
  neoOwnerMedia(f.imported!);
  if (
    f.package_id !== policy.package_id ||
    f.story_id !== policy.story_id ||
    f.content_id !== policy.content_id ||
    f.platform !== "instagram" ||
    f.account_id !== policy.account_id ||
    f.account_external_id !== policy.account_external_id ||
    !["buffer", "simulator"].includes(f.adapter) ||
    f.due_at !== null ||
    f.thread.length ||
    sha(f.caption) !== policy.caption_sha256
  )
    throw Error("NEO_EXACT_SCOPE_REQUIRED");
}
export function neoAcknowledgment(
  id: string,
  d: Candidate,
  actor: string,
  at: string,
) {
  assertNeoScope(d.frozen);
  if (actor !== policy.owner_id) throw Error("NEO_OWNER_REQUIRED");
  return {
    policy_id: policy.id,
    candidate_id: id,
    candidate_checksum: d.checksum,
    owner_id: actor,
    at,
    rights_status: policy.rights_status,
    caption_sha256: policy.caption_sha256,
    ordered_media_sha256: policy.media.map((m) => m.sha256),
    disclosure: policy.disclosure,
    statement: policy.acknowledgment,
  };
}
export function assertNeoAcknowledgment(row: { id: string; data: Candidate }) {
  if (!isNeoRisk(row.data.frozen.imported)) return;
  const d = row.data.decision;
  if (
    !d ||
    d.decision !== "approve" ||
    d.neo_risk_acknowledgment !== policy.id ||
    stable(d.risk_acknowledgment) !==
      stable(neoAcknowledgment(row.id, row.data, d.actor, d.at))
  )
    throw Error("NEO_RISK_ACKNOWLEDGMENT_REQUIRED");
}
