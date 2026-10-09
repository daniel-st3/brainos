import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { queueNewsroomRun } from "../src/newsroom/queue";
import { weightedScore, type CreatorSnapshot } from "../src/creator/discovery";
import { safeSVG } from "../scripts/newsroom/pipeline.mjs";
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
});
afterAll(async () => db.close());
it("queues one isolated job idempotently and exclusively claims it, without touching pilot stories", async () => {
  const before = await rpc("read_newsroom");
  const snapshot = {
    captured_at: new Date().toISOString(),
    briefs: [{ eligible_for_research: true }],
    schema: "creator-discovery/v1",
  } as CreatorSnapshot;
  const id = await queueNewsroomRun(rpc, snapshot);
  expect(await queueNewsroomRun(rpc, snapshot)).toBe(id);
  const jobs = (await Promise.all([
    rpc("claim_newsroom_job"),
    rpc("claim_newsroom_job"),
  ])) as ({ id: string; lease_token: string; is_demo: boolean } | null)[];
  expect(jobs.filter(Boolean)).toHaveLength(1);
  const j = jobs.find(Boolean)!;
  expect(j.id).toBe(id);
  expect(j.is_demo).toBe(true);
  await expect(
    rpc("newsroom_job", {
      p_id: j.id,
      p_token: crypto.randomUUID(),
      p_heartbeat: true,
    }),
  ).rejects.toThrow();
  expect(
    await rpc("newsroom_job", {
      p_id: j.id,
      p_token: j.lease_token,
      p_heartbeat: true,
    }),
  ).toMatchObject({ id });
  expect(await rpc("read_newsroom")).toEqual(before);
  const permissions = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('anon','claim_newsroom_job()','execute') or has_function_privilege('authenticated','newsroom_job(uuid,uuid,boolean)','execute') as allowed",
  );
  expect(permissions.rows[0].allowed).toBe(false);
});
it("rejects executable, external and malformed SVG; permits native editable text and local asset references", () => {
  const good =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><text x="60" y="120">Hola</text><image href="asset:0" width="900" height="600"/></svg>';
  expect(safeSVG(good)).toBe(good);
  for (const bad of [
    good.replace("asset:0", "file:///etc/passwd"),
    good.replace("</svg>", "<script>alert(1)</script></svg>"),
    good.replace("asset:0", "https://example.com/secret"),
    good.replace('width="1080"', 'width="99999999"'),
  ])
    expect(() => safeSVG(bad)).toThrow();
  expect(
    weightedScore({
      hook: 100,
      audience: 100,
      visual: 100,
      novelty: 100,
      evidence: 100,
    }),
  ).toBe(100);
});
