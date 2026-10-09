import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { approvalFixture } from "./approval-fixture";
import { readControl } from "../src/control/service";
import {
  createCandidate,
  decideCandidate,
  resumeCandidate,
} from "../src/approval/service";
import {
  dispatchInputs,
  processOutbox,
  type Outbox,
} from "../src/providers/outbox";
import {
  publicationMedia,
  validateImportedPackage,
} from "../src/approval/imported";
import { BufferClient } from "../src/providers/buffer-client";
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
  const file = (name: string, mime: string, text: string) => ({
    name,
    mime,
    file_id: `${p.id}/external/${sha(text)}/${name}`,
    sha256: sha(text),
    bytes: Buffer.byteLength(text),
  });
  const media = file("reel.mp4", "video/mp4", "fixture video"),
    poster = file("frame.png", "image/png", "fixture frame"),
    caption = "Exact Spanish caption with complete source and credits.\n";
  const rights = {
    status: "DOCUMENTED_BASIS_REQUIRES_FINAL_APPROVAL",
    proposed_use: "Test-only commentary Reel",
    conditions: ["Keep attribution; exception is not a license."],
    assets: [
      {
        id: "demo",
        status: "BASIS_DOCUMENTED",
        kind: "statutory_exception",
        source: "https://example.org/demo",
        basis: "Fixture-only evidence, not a live rights determination.",
      },
    ],
  };
  const texts = {
    "release-rights.json": JSON.stringify(rights),
    "release-assessment.json": JSON.stringify({
      conclusion: "SUPPORTED_WITH_RESIDUAL_RISK",
      media_sha256: media.sha256,
      caption_sha256: sha(caption),
      thumbnail_offset_ms: 800,
      purpose: "Commentary fixture",
      amount: "Two seconds of a one-minute fixture",
      necessity: "Explains the criticized operation",
      market: "Not a replacement for the original",
      jurisdictions: ["CO", "US"],
      risks: ["Case-specific determination"],
      exception_assets: ["demo"],
      authorities: ["https://www.copyright.gov/fair-use/"],
    }),
    "release-media.json": JSON.stringify({
      ...media,
      width: 1080,
      height: 1920,
      duration: 25.1,
      codec: "h264",
      audio_codec: "aac_lc",
      audio_bitrate: 120000,
      thumbnail_offset_ms: 800,
      poster_sha256: poster.sha256,
      source_ids: ["demo"],
    }),
  };
  const documents = Object.entries(texts).map(([name, utf8]) => ({
    name,
    utf8,
    sha256: sha(utf8),
  }));
  const imported = validateImportedPackage(
    {
      schema: "external-publication-package/v1",
      revision: "reel-test",
      archive: file("archive.zip", "application/zip", "archive"),
      caption_sha256: sha(caption),
      media: [media],
      poster,
      files: [
        media,
        poster,
        ...Object.entries(texts).map(([name, utf8]) =>
          file(name, "application/json", utf8),
        ),
      ],
      publication: {
        kind: "documented-instagram-reel/v1",
        platform: "instagram",
        thumbnail_offset_ms: 800,
        fresh_until: new Date(Date.now() + 3600000).toISOString(),
        documents,
      },
      manifests: {
        rights: {
          ...rights,
          overall_risk: "MEDIUM",
          rights_clearance: rights.status,
        },
        sources: {},
        claims: [],
        asset_manifest: [],
        checksums: {},
        production_notes: {},
      },
      factual_check: {
        checked_at: new Date().toISOString(),
        source_url: "https://example.org/demo",
      },
    },
    p.id,
    caption,
  );
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
          format: "video",
          content_state: "review",
          final_approval: null,
          draft_revision: null,
        },
      },
      {
        ...(existing ?? a),
        id: existing?.id ?? randomUUID(),
        version: existing ? existing.version + 1 : 1,
        data: {
          ...a.data,
          platform: "instagram",
          status: "connected",
          external_id: "reel-fixture-account",
          capabilities: ["publish"],
          simulation: "success",
          delivery_transport: "native",
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "SIMULATION fixture",
  });
  return {
    ...f,
    caption,
    media,
    imported,
    review: await createCandidate(rpc, p.id, null, true),
  };
}
it("exact approved Reel reaches guarded private video delivery, simulated receipt and analytics", async () => {
  const f = await fixture();
  expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
  await decideCandidate(
    rpc,
    f.review.id,
    { decision: "approve", checksum: f.review.data.checksum },
    "SIMULATION only",
  );
  const r = await resumeCandidate(rpc, f.review.id),
    row = (
      (await rpc("read_provider_outbox", { p_demo: true })) as Outbox[]
    ).find((o) => o.id === r.outbox_id)!;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  const offline = vi.fn(() => {
    throw Error("No external network");
  });
  const inputs = await dispatchInputs(rpc, row, offline);
  expect(inputs.carousel).toBeUndefined();
  expect(inputs.media).toMatchObject({
    sha256: f.media.sha256,
    thumbnail_offset_ms: 800,
    codec: "h264",
    duration: 25.1,
  });
  expect(inputs.caption).toBe(f.caption);
  const parts = new URL(inputs.media!.url).pathname.split("/"),
    args = { p_id: parts[4], p_hash: sha(parts[5]) };
  expect(await rpc("resolve_media_delivery", args)).toMatchObject({
    sha256: f.media.sha256,
    mime: "video/mp4",
  });
  await processOutbox(rpc, true, offline);
  const s = await readControl(rpc, true);
  expect(
    s.entities.some(
      (e) => e.kind === "publication" && e.data.package_id === f.packageId,
    ),
  ).toBe(true);
  expect(s.jobs.some((j) => j.kind === "analytics")).toBe(true);
  expect(offline).not.toHaveBeenCalled();
  const pack = s.entities.find((e) => e.id === f.packageId)!;
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        ...pack,
        version: pack.version + 1,
        data: { ...pack.data, caption: "Changed" },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "SIMULATION mutate",
  });
  expect(await rpc("resolve_media_delivery", args)).toBeNull();
});
it.each(["reject", "request_changes"] as const)(
  "%s cannot enqueue a Reel",
  async (decision) => {
    const f = await fixture();
    await decideCandidate(
      rpc,
      f.review.id,
      { decision, checksum: f.review.data.checksum },
      "SIMULATION only",
    );
    expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
  },
);
it("unresolved rights, changed caption/media/cover, absent documents and stale facts fail closed", async () => {
  const f = await fixture();
  for (const mutate of [
    (x: typeof f.imported) => {
      x.manifests.rights.assets[0].status = "UNCLEAR";
    },
    (x: typeof f.imported) => {
      x.caption_sha256 = sha("changed");
    },
    (x: typeof f.imported) => {
      x.media[0].sha256 = sha("changed");
    },
    (x: typeof f.imported) => {
      x.publication!.thumbnail_offset_ms = 1200;
    },
    (x: typeof f.imported) => {
      x.poster!.sha256 = sha("different cover");
    },
    (x: typeof f.imported) => {
      x.publication!.documents[0].utf8 += " ";
    },
    (x: typeof f.imported) => {
      x.publication!.fresh_until = new Date(0).toISOString();
    },
  ]) {
    const changed = structuredClone(f.imported);
    mutate(changed);
    expect(() => publicationMedia(changed)).toThrow();
  }
});
it("Buffer draft uses the exact caption, Reel type and bound frame without a separate cover image", async () => {
  const f = await fixture(),
    m = publicationMedia(f.imported)[0];
  const payload = {
    title: "Reel",
    caption: f.caption,
    thread: [],
    source_links: [],
    media_urls: [],
    media: {
      ...m,
      codec: "h264",
      duration: 25.1,
      url: "https://fixture.supabase.co/functions/v1/brainos-media/asset.mp4",
    },
  };
  let input: Record<string, unknown> = {};
  const send = vi.fn(async (_url: string, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    if (req.query.includes("createPost")) {
      input = req.variables.input;
      return Response.json({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: {
              id: "draft-fixture",
              channelId: "reel-fixture-account",
              channelService: "instagram",
              status: "draft",
              schedulingType: "automatic",
              dueAt: null,
              sentAt: null,
              externalLink: null,
            },
          },
        },
      });
    }
    return Response.json({
      data: {
        channel: {
          id: "reel-fixture-account",
          name: "fixture",
          service: "instagram",
          isDisconnected: false,
          isLocked: false,
          isQueuePaused: false,
          allowedActions: ["scheduleUpdates"],
          scopes: ["instagram_business_content_publish"],
        },
      },
    });
  });
  const client = new BufferClient(
    "instagram",
    { access_token: "fixture", expires_at: Date.now() + 3600000, scopes: [] },
    send,
    true,
  );
  await client.createDraft("reel-fixture-account", payload);
  expect(input).toMatchObject({
    saveToDraft: true,
    mode: "addToQueue",
    schedulingType: "automatic",
    text: f.caption,
    metadata: { instagram: { type: "reel" } },
    assets: [
      { video: { url: payload.media.url, metadata: { thumbnailOffset: 800 } } },
    ],
  });
  expect(input).not.toHaveProperty("dueAt");
  await expect(
    client.createDraft("reel-fixture-account", {
      ...payload,
      media: { ...payload.media, thumbnail_offset_ms: 30000 },
    }),
  ).rejects.toThrow("THUMBNAIL");
});
