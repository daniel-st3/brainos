import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { approvalFixture } from "./approval-fixture";
import {
  createCandidate,
  decideCandidate,
  findReview,
} from "../src/approval/service";
const harness = vi.hoisted(() => ({
  rpc: null as unknown as Rpc,
  forToken: vi.fn(),
  until: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("@trigger.dev/sdk", () => ({
  task: (x: unknown) => x,
  schedules: { task: (x: unknown) => x },
  wait: {
    createToken: async () => ({ id: "waitpoint_test" }),
    forToken: harness.forToken,
    until: harness.until,
    completeToken: harness.complete,
  },
  tasks: { trigger: vi.fn() },
}));
vi.mock("../src/ingestion/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ingestion/store")>()),
  applicationRpc: async () => harness.rpc,
}));
import { publicationApproval } from "../src/trigger/approval";
import { readControl } from "../src/control/service";
let db: PGlite, rpc: Rpc;
const execute = (id: string) =>
  (
    publicationApproval as unknown as {
      run: (input: { candidateId: string }) => Promise<unknown>;
    }
  ).run({ candidateId: id });
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
  harness.rpc = rpc;
}, 30000);
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.stubEnv("CONTENT_OS_MODE", "supabase");
  harness.forToken.mockReset();
});
it("registered Trigger task pauses, rereads durable decision, then uses the simulator outbox", async () => {
  const f = await approvalFixture(rpc),
    row = await createCandidate(rpc, f.packageId, null, true);
  harness.forToken.mockImplementation(async () => {
    expect((await findReview(rpc, row.id)).data.wait_token_id).toBe(
      "waitpoint_test",
    );
    expect(
      (await readControl(rpc, true)).entities.some(
        (e) => e.kind === "publication" && e.parent_id === f.contentId,
      ),
    ).toBe(false);
    await decideCandidate(
      rpc,
      row.id,
      { checksum: row.data.checksum, decision: "approve" },
      "SIMULATION reviewer",
    );
    return { ok: true, output: { untrusted: true } };
  });
  await execute(row.id);
  expect(harness.forToken).toHaveBeenCalledOnce();
  expect(
    (await readControl(rpc, true)).entities.find(
      (e) => e.kind === "publication" && e.parent_id === f.contentId,
    )?.data.simulated,
  ).toBe(true);
});
it("forged token output cannot approve a candidate", async () => {
  const f = await approvalFixture(rpc),
    row = await createCandidate(rpc, f.packageId, null, true);
  harness.forToken.mockResolvedValue({ ok: true, output: { approved: true } });
  expect(await execute(row.id)).toEqual({ state: "AWAITING_DANIEL" });
  expect((await findReview(rpc, row.id)).data.outbox_id).toBeNull();
});
it.each(["reject", "request_changes"])(
  "Trigger resume honors %s without dispatch",
  async (decision) => {
    const f = await approvalFixture(rpc),
      row = await createCandidate(rpc, f.packageId, null, true);
    harness.forToken.mockImplementation(async () => {
      await decideCandidate(
        rpc,
        row.id,
        { checksum: row.data.checksum, decision },
        "SIMULATION reviewer",
      );
      return { ok: true, output: { approved: true } };
    });
    await execute(row.id);
    expect((await findReview(rpc, row.id)).data.outbox_id).toBeNull();
  },
);
it("cloud task refuses local persistence", async () => {
  vi.stubEnv("CONTENT_OS_MODE", "demo");
  await expect(execute(crypto.randomUUID())).rejects.toThrow(
    "HOSTED_SUPABASE_REQUIRED",
  );
});
