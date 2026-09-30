import { afterAll, beforeAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { createDemoStories } from "../src/domain/seed";
import { applyCommand } from "../src/domain/workflow";
let db: PGlite;
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
});
afterAll(async () => {
  await db.close();
});
it("applies the real migration and persists the whole relational package", async () => {
  const { rows } = await db.query<{ data: unknown[] }>(
    "select read_newsroom() as data",
  );
  expect(rows[0].data).toHaveLength(7);
});
it("rejects stale concurrent writes atomically", async () => {
  const s = createDemoStories()[0];
  const update = await applyCommand(s, { type: "prioritize" }, "Daniel");
  await db.query("select save_story($1::jsonb,0)", [JSON.stringify(update)]);
  await expect(
    db.query("select save_story($1::jsonb,0)", [JSON.stringify(update)]),
  ).rejects.toThrow("Conflict");
});
it("protects immutable draft content even from direct database updates", async () => {
  await expect(
    db.exec("update drafts set body='tampered' where revision=2"),
  ).rejects.toThrow("immutable");
});
it("protects approval history and append-only events", async () => {
  await expect(
    db.exec("update drafts set approved_at=null where status='approved'"),
  ).rejects.toThrow("immutable");
  await expect(db.exec("delete from events")).rejects.toThrow("append-only");
});
it("denies browser roles access to tables and mutation RPC", async () => {
  const r = await db.query<{ allowed: boolean }>(
    "select has_table_privilege('anon','stories','SELECT') or has_function_privilege('authenticated','save_story(jsonb,integer)','EXECUTE') as allowed",
  );
  expect(r.rows[0].allowed).toBe(false);
});
it("rolls back a package with invalid asset clearance", async () => {
  const s = createDemoStories()[4];
  s.version = 1;
  s.assets[0].rights_status = "unknown";
  s.assets[0].publishable = false;
  await expect(
    db.query("select save_story($1::jsonb,0)", [JSON.stringify(s)]),
  ).rejects.toThrow("Asset clearance");
  const r = await db.query<{ version: number }>(
    "select version from stories where id=$1",
    [s.id],
  );
  expect(r.rows[0].version).toBe(0);
});
