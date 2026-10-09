import { beforeEach, afterEach, expect, it, vi } from "vitest";
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
  findReview,
} from "../src/approval/service";
import {
  publicationMedia,
  validateImportedPackage,
} from "../src/approval/imported";
import { neoPolicy as policy } from "../src/approval/neo-policy";
import { assertNeoAcknowledgment } from "../src/approval/neo-publication";
import {
  dispatchInputs,
  processOutbox,
  type Outbox,
} from "../src/providers/outbox";
const caption =
  "¿Dejarías entrar un robot en tu casa? 👀\n\nNEO, de 1X, promete ayudarte con las tareas domésticas para devolverte tiempo.\n\nPero hay un detalle: cuando no sabe hacer algo, puede necesitar asistencia humana remota.\n\nLa pregunta es qué tanto acceso a tu hogar estarías dispuesto a darle.\n\n¿Lo tendrías? 🤖";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let db: PGlite, rpc: Rpc;
beforeEach(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
}, 30000);
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});
async function fixture() {
  const f = await approvalFixture(rpc),
    s = await readControl(rpc, true),
    p = s.entities.find((e) => e.id === f.packageId)!,
    c = s.entities.find((e) => e.id === f.contentId)!,
    a = s.entities.find(
      (e) => e.kind === "account" && e.data.platform === "x",
    )!;
  await db.query(
    `insert into stories select (jsonb_populate_record(null::stories,to_jsonb(s)||jsonb_build_object('id',$1::text))).* from stories s where id=$2`,
    [policy.story_id, c.story_id],
  );
  const file = (name: string, text: string) => ({
    name,
    file_id: `${policy.package_id}/external/${sha(text)}/${name}`,
    sha256: sha(text),
    mime: "application/json",
    bytes: Buffer.byteLength(text),
  });
  const media = policy.media.map((m) => ({
    ...m,
    mime: "image/png",
    file_id: `${policy.package_id}/external/${m.sha256}/${m.name}`,
  }));
  const original = {
    status: "PRIVATE_STUDY_ONLY",
    cover_use_permission: "NOT_OBTAINED",
  };
  const texts = {
    "owner-risk.json": JSON.stringify(policy),
    "rights.json": JSON.stringify(original),
    "manifest.json": JSON.stringify({ media }),
  };
  const documents = Object.entries(texts).map(([name, utf8]) => ({
    name,
    utf8,
    sha256: sha(utf8),
  }));
  const im = validateImportedPackage(
    {
      schema: "external-publication-package/v1",
      revision: "NEO-OWNER-RISK-1",
      archive: { ...file("archive.zip", "archive"), mime: "application/zip" },
      caption_sha256: sha(caption),
      media,
      files: [...media, ...Object.entries(texts).map(([n, t]) => file(n, t))],
      publication: {
        kind: policy.kind,
        platform: "instagram",
        fresh_until: new Date(Date.now() + 3600000).toISOString(),
        documents,
      },
      manifests: {
        rights: {
          overall_risk: "MEDIUM",
          rights_clearance: "UNCLEAR",
          assets: [
            {
              id: "1x-photography",
              status: "UNCLEAR",
              basis:
                "Rights remain unresolved; this is an owner risk decision.",
            },
          ],
          disclosure: policy.disclosure,
          acknowledgment: policy.acknowledgment,
          original_record: original,
        },
        sources: {},
        claims: [],
        checksums: {},
        asset_manifest: [],
        production_notes: {},
      },
      factual_check: {
        checked_at: new Date().toISOString(),
        source_url: "https://www.1x.tech/neo",
      },
    },
    policy.package_id,
    caption,
  );
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        ...c,
        id: policy.content_id,
        version: 1,
        story_id: policy.story_id,
        draft_id: null,
        data: {
          ...c.data,
          content_state: "review",
          format: "carousel",
          platform: "instagram",
          draft_revision: null,
          final_approval: null,
        },
      },
      {
        ...p,
        id: policy.package_id,
        version: 1,
        story_id: policy.story_id,
        parent_id: policy.content_id,
        draft_id: null,
        data: {
          ...p.data,
          content_id: policy.content_id,
          content_version: 1,
          platform: "instagram",
          draft_id: "",
          draft_revision: 0,
          caption,
          thread: [],
          graphic_ids: [],
          imported: im,
        },
      },
      {
        ...a,
        id: policy.account_id,
        version: 1,
        data: {
          ...a.data,
          platform: "instagram",
          external_id: policy.account_external_id,
          simulation: "success",
          capabilities: ["publish"],
          status: "connected",
          delivery_transport: "native",
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "LOCAL SIMULATION ONLY",
  });
  const row = await createCandidate(rpc, policy.package_id, null, true);
  return { row, im };
}
const approve = (r: Awaited<ReturnType<typeof fixture>>["row"]) =>
  decideCandidate(
    rpc,
    r.id,
    {
      decision: "approve",
      checksum: r.data.checksum,
      neo_risk_acknowledgment: policy.id,
    },
    policy.owner_id,
  );
it("requires owner plus explicit acknowledgment and persists nothing on failure", async () => {
  const { row } = await fixture();
  await expect(
    decideCandidate(
      rpc,
      row.id,
      { decision: "approve", checksum: row.data.checksum },
      policy.owner_id,
    ),
  ).rejects.toThrow("NEO_RISK_ACKNOWLEDGMENT_REQUIRED");
  await expect(
    decideCandidate(
      rpc,
      row.id,
      {
        decision: "approve",
        checksum: row.data.checksum,
        neo_risk_acknowledgment: policy.id,
      },
      randomUUID(),
    ),
  ).rejects.toThrow("NEO_OWNER_REQUIRED");
  expect((await findReview(rpc, row.id)).data.decision).toBeNull();
  expect((await resumeCandidate(rpc, row.id)).outbox_id).toBeNull();
});
it("binds owner risk to exact candidate, queues once, preserves four images and records simulator receipt/analytics", async () => {
  const { row } = await fixture(),
    r = await approve(row);
  assertNeoAcknowledgment(r);
  expect(r.data.decision?.risk_acknowledgment).toMatchObject({
    candidate_id: row.id,
    candidate_checksum: row.data.checksum,
    owner_id: policy.owner_id,
    rights_status: "UNCLEAR",
    caption_sha256: policy.caption_sha256,
    ordered_media_sha256: policy.media.map((m) => m.sha256),
  });
  expect((await approve(row)).id).toBe(row.id);
  const one = await resumeCandidate(rpc, row.id),
    two = await resumeCandidate(rpc, row.id);
  expect(two.outbox_id).toBe(one.outbox_id);
  const o = (
    (await rpc("read_provider_outbox", { p_demo: true })) as Outbox[]
  ).find((o) => o.id === one.outbox_id)!;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://media.example.test");
  const noNetwork = () => {
    throw Error("Unexpected network");
  };
  const payload = await dispatchInputs(rpc, o, noNetwork);
  expect(payload.caption).toBe(caption);
  expect(payload.carousel?.map((m) => m.sha256)).toEqual(
    policy.media.map((m) => m.sha256),
  );
  for (const m of payload.carousel!) {
    const path = new URL(m.url).pathname.split("/");
    expect(
      await rpc("resolve_media_delivery", {
        p_id: path[4],
        p_hash: sha(path[5]),
      }),
    ).toBeTruthy();
  }
  await processOutbox(rpc, true, noNetwork);
  const end = await readControl(rpc, true),
    pub = end.entities.find(
      (e) =>
        e.kind === "publication" && e.data.package_id === policy.package_id,
    )!;
  expect(pub.data.simulated).toBe(true);
  expect(
    end.jobs.filter((j) => j.entity_id === pub.id && j.kind === "analytics"),
  ).toHaveLength(3);
  expect(
    (await findReview(rpc, row.id)).data.frozen.imported!.manifests.rights
      .rights_clearance,
  ).toBe("UNCLEAR");
});
it.each(["reject", "request_changes"] as const)(
  "%s never authorizes an outbox",
  async (decision) => {
    const { row } = await fixture();
    await decideCandidate(
      rpc,
      row.id,
      { decision, checksum: row.data.checksum },
      policy.owner_id,
    );
    expect((await resumeCandidate(rpc, row.id)).outbox_id).toBeNull();
  },
);
it("fails closed on another package, media order, caption, false clearance and altered disclosure", async () => {
  const { im } = await fixture();
  for (const mutate of [
    (x: typeof im) => x.media.reverse(),
    (x: typeof im) =>
      (x.media[0].file_id = x.media[0].file_id.replace(
        policy.package_id,
        randomUUID(),
      )),
    (x: typeof im) => (x.caption_sha256 = "0".repeat(64)),
    (x: typeof im) => (x.manifests.rights.rights_clearance = "CLEARED"),
    (x: typeof im) => (x.manifests.rights.disclosure = "risk hidden"),
  ]) {
    const x = structuredClone(im);
    mutate(x);
    expect(() => publicationMedia(x)).toThrow();
  }
});
it("revokes downstream delivery if acknowledgment is removed; stale captions need fresh review", async () => {
  const { row } = await fixture();
  await approve(row);
  const r = await resumeCandidate(rpc, row.id);
  const o = (
    (await rpc("read_provider_outbox", { p_demo: true })) as Outbox[]
  ).find((o) => o.id === r.outbox_id)!;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://media.example.test");
  const payload = await dispatchInputs(rpc, o, () => {
    throw Error("network");
  });
  const parts = new URL(payload.carousel![0].url).pathname.split("/");
  await expect(
    db.query(
      `update control_entities set data=jsonb_set(data,'{decision}',(data->'decision')-'risk_acknowledgment') where id=$1`,
      [row.id],
    ),
  ).rejects.toThrow("Decision is immutable");
  const tampered = structuredClone(await findReview(rpc, row.id));
  delete tampered.data.decision!.risk_acknowledgment;
  expect(() => assertNeoAcknowledgment(tampered)).toThrow(
    "NEO_RISK_ACKNOWLEDGMENT_REQUIRED",
  );
  await db.query(
    `update control_entities set data=jsonb_set(data,'{caption}','"Changed caption"'::jsonb) where id=$1`,
    [policy.package_id],
  );

  expect(
    await rpc("resolve_media_delivery", {
      p_id: parts[4],
      p_hash: sha(parts[5]),
    }),
  ).toBeNull();
});
