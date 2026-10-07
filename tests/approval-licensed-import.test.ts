import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { approvalFixture } from "./approval-fixture";
import { readControl, controlSnapshot } from "../src/control/service";
import {
  createCandidate,
  decideCandidate,
  resumeCandidate,
  assertCurrent,
} from "../src/approval/service";
import {
  dispatchInputs,
  processOutbox,
  type Outbox,
} from "../src/providers/outbox";
import {
  licensedImageMedia,
  validateImportedPackage,
} from "../src/approval/imported";
let db: PGlite, rpc: Rpc;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
}, 30000);
afterAll(async () => {
  await db.close();
});
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const f = await approvalFixture(rpc),
    s = await readControl(rpc, true),
    p = s.entities.find((e) => e.id === f.packageId)!,
    c = s.entities.find((e) => e.id === f.contentId)!,
    a = s.entities.find(
      (e) => e.kind === "account" && e.data.platform === "x",
    )!;
  const media = ["01.png", "02.png", "03.png"].map((name, i) => ({
    name,
    file_id: `${p.id}/external/${sha("image" + i)}/${name}`,
    mime: "image/png",
    sha256: sha("image" + i),
    bytes: 6,
  }));
  const rights = {
    status: "CLEARED FOR PROPOSED DVNI USE",
    proposed_use: "Test-only licensed editorial image carousel",
    conditions: ["Keep attribution and CC BY-SA 4.0 license."],
    assets: [
      {
        id: "photo",
        status: "CLEARED",
        source: "https://example.com/source",
        license: "CC BY-SA 4.0",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
        permission_basis: "Explicit licensed fixture",
      },
    ],
  };
  const manifest = media.map((m, i) => ({
    path: m.name,
    order: i + 1,
    sha256: m.sha256,
    bytes: m.bytes,
    dimensions: [1080, 1350],
    media_type: m.mime,
    rights_status: "CLEARED",
    source_ids: ["photo"],
  }));
  const texts = {
    "rights.json": JSON.stringify(rights),
    "LICENSE.txt": "CC BY-SA 4.0; attribution retained.",
    "asset-manifest.json": JSON.stringify(manifest),
  };
  const documents = Object.entries(texts).map(([name, utf8]) => ({
    name,
    utf8,
    sha256: sha(utf8),
  }));
  const files = [
    ...media,
    ...documents.map((d) => ({
      name: d.name,
      file_id: `${p.id}/external/${d.sha256}/${d.name}`,
      sha256: d.sha256,
      mime: d.name.endsWith(".json") ? "application/json" : "text/plain",
      bytes: Buffer.byteLength(d.utf8),
    })),
  ];
  const caption = "Exact caption + attribution.\nCC BY-SA 4.0\n";
  const imported = {
    schema: "external-publication-package/v1",
    revision: "V2",
    archive: { ...media[0], name: "fixture.zip", mime: "application/zip" },
    caption_sha256: sha(caption),
    media,
    files,
    publication: {
      kind: "licensed-image-carousel/v1",
      platform: "instagram",
      fresh_until: new Date(Date.now() + 3600000).toISOString(),
      documents,
    },
    manifests: {
      rights: {
        ...rights,
        overall_risk: "CLEARED",
        rights_clearance: "CLEARED",
        assets: rights.assets.map((x) => ({ ...x, basis: x.permission_basis })),
      },
      sources: {},
      claims: [],
      asset_manifest: manifest,
      checksums: {},
      production_notes: {},
    },
    factual_check: {
      checked_at: new Date().toISOString(),
      source_url: "https://example.com/source",
      checks: { claim: "verified" },
    },
  };
  const existing = s.entities.find(
    (e) => e.kind === "account" && e.data.platform === "instagram",
  );
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        ...p,
        version: p.version + 1,
        draft_id: null,
        data: {
          ...p.data,
          platform: "instagram",
          status: "draft",
          draft_id: "",
          draft_revision: 0,
          caption,
          imported,
        },
      },
      {
        ...c,
        version: c.version + 1,
        draft_id: null,
        data: {
          ...c.data,
          platform: "instagram",
          content_state: "review",
          draft_revision: null,
          final_approval: null,
        },
      },
      {
        ...(existing ?? a),
        id: existing?.id ?? randomUUID(),
        version: existing ? existing.version + 1 : 1,
        data: { ...a.data, platform: "instagram", simulation: "success" },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "SIMULATION fixture",
  });
  return {
    ...f,
    imported,
    media,
    caption,
    review: await createCandidate(rpc, p.id, null, true),
  };
}
it("cleared images require exact human approval, then use existing outbox, media guard, receipt and analytics", async () => {
  const f = await fixture();
  expect(f.review.data.state).toBe("AWAITING_DANIEL");
  expect(f.review.data.frozen.caption).toBe(f.caption);
  expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
  await decideCandidate(
    rpc,
    f.review.id,
    { checksum: f.review.data.checksum, decision: "approve" },
    "SIMULATION Daniel",
  );
  const result = await resumeCandidate(rpc, f.review.id);
  expect(result.outbox_id).toBeTruthy();
  expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBe(
    result.outbox_id,
  );
  const rows = (await rpc("read_provider_outbox", {
    p_demo: true,
  })) as Outbox[];
  const row = rows.find((r) => r.id === result.outbox_id)!;
  expect(row.payload.imported_refs?.map((m) => m.sha256)).toEqual(
    f.media.map((m) => m.sha256),
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  const network = vi.fn(() => {
    throw Error("No external network permitted");
  });
  const inputs = await dispatchInputs(rpc, row, network);
  expect(inputs.caption).toBe(f.caption);
  expect(inputs.carousel?.map((m) => m.mime)).toEqual([
    "image/png",
    "image/png",
    "image/png",
  ]);
  expect(inputs.carousel?.map((m) => m.sha256)).toEqual(
    f.media.map((m) => m.sha256),
  );
  for (const [i, m] of inputs.carousel!.entries()) {
    const parts = new URL(m.url).pathname.split("/");
    const value = await rpc("resolve_media_delivery", {
      p_id: parts[4],
      p_hash: sha(parts[5]),
    });
    expect(value).toMatchObject({
      file_id: f.media[i].file_id,
      sha256: m.sha256,
      mime: "image/png",
    });
  }
  await processOutbox(rpc, true, network);
  expect(network).not.toHaveBeenCalled();
  const s = await readControl(rpc, true);
  expect(
    s.entities.some(
      (e) => e.kind === "publication" && e.data.package_id === f.packageId,
    ),
  ).toBe(true);
  expect(s.jobs.some((j) => j.kind === "analytics")).toBe(true);
});
it.each(["reject", "request_changes"])(
  "%s is terminal and cannot enqueue a licensed import",
  async (decision) => {
    const f = await fixture();
    await decideCandidate(
      rpc,
      f.review.id,
      { checksum: f.review.data.checksum, decision },
      "SIMULATION Daniel",
    );
    expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
    expect(
      ((await rpc("read_provider_outbox", { p_demo: true })) as Outbox[]).some(
        (r) => r.package_id === f.packageId,
      ),
    ).toBe(false);
  },
);
it("does not clear unknown rights by adding publication metadata", async () => {
  const f = await fixture();
  const changed = structuredClone(f.imported);
  changed.manifests.rights.assets[0].status = "UNCLEAR";
  expect(() =>
    licensedImageMedia(
      validateImportedPackage(changed, f.packageId, f.caption),
    ),
  ).toThrow("CLEARED_SOURCE_RIGHTS");
  const modified = structuredClone(f.imported);
  modified.publication.documents[0].utf8 += " ";
  expect(() =>
    licensedImageMedia(
      validateImportedPackage(modified, f.packageId, f.caption),
    ),
  ).toThrow("LICENSE_DOCUMENT_BINDING");
  const expired = structuredClone(f.imported);
  expired.publication.fresh_until = new Date(Date.now() - 1).toISOString();
  expect(() =>
    licensedImageMedia(
      validateImportedPackage(expired, f.packageId, f.caption),
    ),
  ).toThrow("REVALIDATION");
});
it("caption, attribution, media ordering and revision remain immutable after preparation", async () => {
  const f = await fixture(),
    s = await readControl(rpc, true),
    p = s.entities.find((e) => e.id === f.packageId)!;
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        ...p,
        version: p.version + 1,
        data: { ...p.data, caption: f.caption.trim() },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "SIMULATION revision",
  });
  const awaitSnapshot = await controlSnapshot(rpc, true);
  expect(() => assertCurrent(awaitSnapshot, f.review)).toThrow();
  await expect(
    decideCandidate(
      rpc,
      f.review.id,
      { checksum: f.review.data.checksum, decision: "approve" },
      "SIMULATION Daniel",
    ),
  ).rejects.toThrow();
  expect(
    ((await rpc("read_provider_outbox", { p_demo: true })) as Outbox[]).some(
      (r) => r.package_id === f.packageId,
    ),
  ).toBe(false);
});
it("withdraws existing delivery URLs when the licensed package changes", async () => {
  const f = await fixture();
  await decideCandidate(
    rpc,
    f.review.id,
    { checksum: f.review.data.checksum, decision: "approve" },
    "SIMULATION Daniel",
  );
  const result = await resumeCandidate(rpc, f.review.id);
  const row = (
    (await rpc("read_provider_outbox", { p_demo: true })) as Outbox[]
  ).find((r) => r.id === result.outbox_id)!;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  const inputs = await dispatchInputs(rpc, row, () => {
    throw Error("No external network permitted");
  });
  const parts = new URL(inputs.carousel![0].url).pathname.split("/");
  const args = { p_id: parts[4], p_hash: sha(parts[5]) };
  expect(await rpc("resolve_media_delivery", args)).toBeTruthy();
  const state = await readControl(rpc, true),
    pkg = state.entities.find((e) => e.id === f.packageId)!;
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        ...pkg,
        version: pkg.version + 1,
        data: { ...pkg.data, caption: "Changed attribution" },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "SIMULATION changed source",
  });
  expect(await rpc("resolve_media_delivery", args)).toBeNull();
});
