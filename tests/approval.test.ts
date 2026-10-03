import { beforeAll, afterAll, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { approvalFixture } from "./approval-fixture";
import {
  createCandidate,
  decideCandidate,
  resumeCandidate,
  findReview,
} from "../src/approval/service";
import { readControl } from "../src/control/service";
import { processOutbox } from "../src/providers/outbox";
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
  const f = await approvalFixture(rpc);
  return { ...f, review: await createCandidate(rpc, f.packageId, null, true) };
}
it("freezes exact package, notifies once and awaits without approval or outbox", async () => {
  const f = await fixture();
  expect((await createCandidate(rpc, f.packageId, null, true)).id).toBe(
    f.review.id,
  );
  expect(f.review.data.state).toBe("AWAITING_DANIEL");
  expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
  const state = await readControl(rpc, true);
  expect(
    state.entities.filter(
      (e) => e.kind === "notification" && e.parent_id === f.review.id,
    ),
  ).toHaveLength(1);
  expect(
    state.entities.find((e) => e.id === f.contentId)!.data.final_approval,
  ).toBeNull();
});
it("exact approval resumes idempotently through simulator, keeps receipt and analytics jobs", async () => {
  const f = await fixture(),
    input = {
      checksum: f.review.data.checksum,
      decision: "approve",
      feedback: "",
    };
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(Error("No network allowed"));
  try {
    await decideCandidate(rpc, f.review.id, input, "SIMULATION reviewer");
    await decideCandidate(rpc, f.review.id, input, "SIMULATION reviewer");
    const first = await resumeCandidate(rpc, f.review.id);
    expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBe(
      first.outbox_id,
    );
    await processOutbox(rpc, true);
    const state = await readControl(rpc, true),
      receipt = state.entities.find(
        (e) => e.kind === "publication" && e.data.package_id === f.packageId,
      )!;
    expect(receipt.data.simulated).toBe(true);
    expect(receipt.data.external_id).toBeTruthy();
    expect(
      state.jobs.filter(
        (j) => j.kind === "analytics" && j.entity_id === receipt.id,
      ),
    ).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
it.each(["reject", "request_changes"])(
  "%s ends the publication path and preserves feedback",
  async (decision) => {
    const f = await fixture();
    await decideCandidate(
      rpc,
      f.review.id,
      {
        checksum: f.review.data.checksum,
        decision,
        feedback: "Keep this exact feedback.",
      },
      "SIMULATION reviewer",
    );
    expect((await resumeCandidate(rpc, f.review.id)).outbox_id).toBeNull();
    expect((await findReview(rpc, f.review.id)).data.decision?.feedback).toBe(
      "Keep this exact feedback.",
    );
    await expect(
      decideCandidate(
        rpc,
        f.review.id,
        { checksum: f.review.data.checksum, decision: "approve" },
        "SIMULATION reviewer",
      ),
    ).rejects.toThrow("DECISION_ALREADY_RECORDED");
  },
);
it("wrong hash and changed package cannot receive approval", async () => {
  const f = await fixture();
  await expect(
    decideCandidate(
      rpc,
      f.review.id,
      { checksum: "0".repeat(64), decision: "approve" },
      "SIMULATION reviewer",
    ),
  ).rejects.toThrow("STALE");
  await db.query(
    "update control_entities set data=jsonb_set(data,'{caption}', '\"Changed caption\"'),version=version+1 where id=$1",
    [f.packageId],
  );
  await expect(
    decideCandidate(
      rpc,
      f.review.id,
      { checksum: f.review.data.checksum, decision: "approve" },
      "SIMULATION reviewer",
    ),
  ).rejects.toThrow("STALE");
});
it("database prevents rewriting immutable media/caption/timing or recorded decisions", async () => {
  const f = await fixture();
  await expect(
    db.query(
      "update control_entities set data=jsonb_set(data,'{frozen,caption}','\"Changed\"') where id=$1",
      [f.review.id],
    ),
  ).rejects.toThrow("Immutable");
  await decideCandidate(
    rpc,
    f.review.id,
    { checksum: f.review.data.checksum, decision: "reject" },
    "SIMULATION reviewer",
  );
  await expect(
    db.query(
      "update control_entities set data=jsonb_set(data,'{decision,decision}','\"approve\"') where id=$1",
      [f.review.id],
    ),
  ).rejects.toThrow("immutable");
});
it("post-approval mutation blocks resume and scheduled sends remain queued until due", async () => {
  const f = await fixture();
  await decideCandidate(
    rpc,
    f.review.id,
    { checksum: f.review.data.checksum, decision: "approve" },
    "SIMULATION reviewer",
  );
  await db.query(
    "update control_entities set data=jsonb_set(data,'{caption}','\"Mutation\"'),version=version+1 where id=$1",
    [f.packageId],
  );
  await expect(resumeCandidate(rpc, f.review.id)).rejects.toThrow("STALE");
  const g = await approvalFixture(rpc),
    due = new Date(Date.now() + 86400000).toISOString(),
    review = await createCandidate(rpc, g.packageId, due, true);
  await decideCandidate(
    rpc,
    review.id,
    { checksum: review.data.checksum, decision: "approve" },
    "SIMULATION reviewer",
  );
  await resumeCandidate(rpc, review.id);
  await processOutbox(rpc, true);
  const outbox = (await rpc("read_provider_outbox", { p_demo: true })) as {
    package_id: string;
    status: string;
    due_at: string;
  }[];
  expect(outbox.find((o) => o.package_id === g.packageId)?.status).toBe(
    "queued",
  );
});
it("mutation after enqueue is rejected again by the existing dispatch boundary", async () => {
  const f = await fixture();
  await decideCandidate(
    rpc,
    f.review.id,
    { checksum: f.review.data.checksum, decision: "approve" },
    "SIMULATION reviewer",
  );
  await resumeCandidate(rpc, f.review.id);
  await db.query(
    "update control_entities set data=jsonb_set(data,'{title}','\"Changed source content\"') where id=$1",
    [f.contentId],
  );
  await processOutbox(rpc, true);
  expect(
    (await readControl(rpc, true)).entities.some(
      (e) => e.kind === "publication" && e.data.package_id === f.packageId,
    ),
  ).toBe(false);
});
it("demo cannot resolve a real provider and unresolved media cannot be frozen", async () => {
  const f = await approvalFixture(rpc);
  await db.exec(
    "update control_entities set data=data-'simulation' where kind='account' and is_demo",
  );
  await expect(createCandidate(rpc, f.packageId, null, true)).rejects.toThrow(
    "STAGING_SIMULATOR_REQUIRED",
  );
});
it("binds ordered final raster checksums and rejects stale or missing media", async () => {
  const f = await approvalFixture(rpc, true),
    row = await createCandidate(rpc, f.packageId, null, true);
  expect(row.data.frozen.media).toHaveLength(1);
  expect(row.data.frozen.media[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  const graphic = row.data.frozen.media[0].graphic_id!;
  await db.query(
    "update control_entities set data=jsonb_set(data,'{outputs,0,png,sha256}', '\"0000000000000000000000000000000000000000000000000000000000000000\"') where id=$1",
    [graphic],
  );
  await expect(
    decideCandidate(
      rpc,
      row.id,
      { checksum: row.data.checksum, decision: "approve" },
      "SIMULATION reviewer",
    ),
  ).rejects.toThrow("STALE");
});
it("anonymous roles cannot mutate approval records or call its database guard", async () => {
  await db.exec("set role anon");
  try {
    await expect(db.query("select * from control_entities")).rejects.toThrow();
    await expect(db.query("select guard_cloud_approval()")).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
it("content revision changes invalidate a candidate even when copy is identical", async () => {
  const f = await fixture();
  expect(f.review.data.frozen.content_version).toBeGreaterThan(0);
  await db.query("update control_entities set version=version+1 where id=$1", [
    f.contentId,
  ]);
  await expect(
    decideCandidate(
      rpc,
      f.review.id,
      { checksum: f.review.data.checksum, decision: "approve" },
      "SIMULATION reviewer",
    ),
  ).rejects.toThrow("STALE");
});
