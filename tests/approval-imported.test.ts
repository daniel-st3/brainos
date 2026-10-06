import { beforeAll, afterAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { enqueueOutbox } from "../src/providers/outbox";
import { approvalFixture } from "./approval-fixture";
import {
  createCandidate,
  decideCandidate,
  resumeCandidate,
  assertCurrent,
} from "../src/approval/service";
import { readControl, controlSnapshot } from "../src/control/service";
import { validateImportedPackage } from "../src/approval/imported";
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
}, 30000);
afterAll(async () => {
  await db.close();
});
async function fixture() {
  const f = await approvalFixture(rpc),
    s = await readControl(rpc, true),
    p = s.entities.find((e) => e.id === f.packageId)!;
  const media = ["01.mp4", "02.png", "03.png"].map((name, i) => ({
    name,
    file_id: `${p.id}/external/${name}`,
    mime: i ? "image/png" : "video/mp4",
    bytes: 100,
    sha256: String(i + 1).repeat(64),
  }));
  const caption = "Exact caption.\n\n";
  const imported = {
    schema: "external-publication-package/v1",
    revision: "V2",
    archive: { ...media[0], name: "package.zip", mime: "application/zip" },
    caption_sha256: createHash("sha256").update(caption).digest("hex"),
    media,
    files: media,
    poster: { ...media[1] },
    manifests: {
      rights: {
        overall_risk: "MEDIUM",
        rights_clearance: "PENDING",
        assets: [{ id: "A1", status: "UNCLEAR", basis: "No reuse grant" }],
      },
      sources: {},
      claims: {},
      asset_manifest: {},
      checksums: {},
      production_notes: {},
    },
    factual_check: {
      checked_at: new Date().toISOString(),
      source_url: "https://example.com",
      price: "3499",
      availability: "Sold Out",
      shipping: "October 31",
    },
  };
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        ...p,
        version: p.version + 1,
        data: { ...p.data, status: "draft", caption, imported },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "test setup",
  });
  return {
    ...f,
    imported,
    caption,
    review: await createCandidate(rpc, p.id, null, true),
  };
}
it("imports pending rights without approval, preserves exact caption/order/bytes and notifies once", async () => {
  const f = await fixture();
  expect(f.review.data.frozen.media.map((m) => m.sha256)).toEqual([
    "1".repeat(64),
    "2".repeat(64),
    "3".repeat(64),
  ]);
  expect(f.review.data.frozen.caption).toBe(f.caption);
  expect(f.review.data.frozen.imported?.manifests.rights.assets[0].status).toBe(
    "UNCLEAR",
  );
  expect(f.review.data.state).toBe("AWAITING_DANIEL");
  expect(f.review.data.decision).toBeNull();
  expect((await createCandidate(rpc, f.packageId, null, true)).id).toBe(
    f.review.id,
  );
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) => e.kind === "notification" && e.parent_id === f.review.id,
    ),
  ).toHaveLength(1);
  expect(() =>
    validateImportedPackage(f.imported, f.packageId, f.caption.trim()),
  ).toThrow("EXACT_CAPTION");
  expect(() =>
    validateImportedPackage(
      {
        ...f.imported,
        media: [{ ...f.imported.media[0], file_id: "another/file.mp4" }],
      },
      f.packageId,
      f.caption,
    ),
  ).toThrow("PACKAGE_MEDIA");
});
it("human review approval never grants rights, final publication authority, or an outbox for an unsupported external package", async () => {
  const f = await fixture();
  await decideCandidate(
    rpc,
    f.review.id,
    { checksum: f.review.data.checksum, decision: "approve" },
    "test reviewer",
  );
  const result = await resumeCandidate(rpc, f.review.id);
  expect(result.outbox_id).toBeNull();
  expect(result.state).toBe("APPROVED");
  await expect(
    enqueueOutbox(rpc, f.packageId, new Date().toISOString(), true),
  ).rejects.toThrow("IMPORTED_PACKAGE_REVIEW_ONLY");
  expect(
    (await readControl(rpc, true)).entities.find((e) => e.id === f.contentId)!
      .data.final_approval,
  ).toBeNull();
  expect(
    (await rpc("read_provider_outbox", { p_demo: true })) as unknown[],
  ).toHaveLength(0);
});
it.each(["reject", "request_changes"])(
  "%s never creates outbox",
  async (decision) => {
    const f = await fixture();
    await decideCandidate(
      rpc,
      f.review.id,
      { checksum: f.review.data.checksum, decision },
      "test reviewer",
    );
    expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
  },
);
it("package mutation invalidates the imported candidate, including media order and rights", async () => {
  const f = await fixture(),
    s = await readControl(rpc, true),
    p = s.entities.find((e) => e.id === f.packageId)!;
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        ...p,
        version: p.version + 1,
        data: {
          ...p.data,
          imported: { ...f.imported, media: [...f.imported.media].reverse() },
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "test mutation",
  });
  const snapshot = await controlSnapshot(rpc, true);
  expect(() => assertCurrent(snapshot, f.review)).toThrow("STALE_CANDIDATE");
});
