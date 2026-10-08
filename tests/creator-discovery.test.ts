import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  collectCreatorBriefs,
  creatorSources,
  qualify,
  runCreatorDiscovery,
  weightedScore,
} from "../src/creator/discovery";
import { makeDiscovery, type Fetcher } from "../src/ingestion/adapters";
let db: PGlite, rpc: Rpc;
const now = "2026-10-08T20:00:00.000Z";
const item = () =>
  makeDiscovery(
    creatorSources[0],
    {
      id: "test",
      url: "https://openai.com/news/robot",
      title: "New AI robot helps people work",
      body: "Official product demonstration. <img src='https://openai.com/robot.png'/>",
      published: "2026-10-08T10:00:00Z",
    },
    now,
  );
const fetcher: Fetcher = async (url) => ({
  url,
  status: 200,
  contentType: "application/rss+xml",
  body: `<rss version="2.0"><channel><item><title>New AI robot helps people work</title><link>${new URL(url).origin === "https://feeds.arstechnica.com" ? "https://arstechnica.com" : new URL(url).origin}/robot</link><pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate><description>Real demo for AI users</description></item></channel></rss>`,
});
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
});
afterAll(async () => db.close());
it("uses the requested experimental weights without confusing proxies with verification", () => {
  expect(
    weightedScore({
      hook: 100,
      audience: 0,
      visual: 0,
      novelty: 0,
      evidence: 0,
    }),
  ).toBe(30);
  expect(
    weightedScore({
      hook: 100,
      audience: 100,
      visual: 100,
      novelty: 100,
      evidence: 100,
    }),
  ).toBe(100);
  expect(() =>
    weightedScore({
      hook: NaN,
      audience: 0,
      visual: 0,
      novelty: 0,
      evidence: 0,
    }),
  ).toThrow();
  const q = qualify(item(), creatorSources[0], now);
  expect(q.eligible_for_research).toBe(true);
  expect(q.status).toBe("STORY_BRIEF");
  expect(q.publishable).toBe(false);
  expect(q.media_candidates[0]).toMatchObject({
    rights: "UNCLEAR",
    downloaded: false,
    selected: false,
  });
  expect(q.blockers).toContain("PRIMARY_CLAIMS_NOT_VERIFIED");
});
it("does not fill a quota with stale, future or unrelated feed entries", () => {
  for (const date of [null, "2026-10-01T00:00:00Z", "2026-10-09T00:00:00Z"])
    expect(
      qualify({ ...item(), publishedAt: date }, creatorSources[0], now)
        .eligible_for_research,
    ).toBe(false);
  expect(
    qualify(
      { ...item(), title: "New phone", excerpt: "A phone case" },
      creatorSources[0],
      now,
    ).eligible_for_research,
  ).toBe(false);
});
it("retains safe failures and allows an empty shortlist", async () => {
  const s = await collectCreatorBriefs(now, async () => {
    throw Error("SECRET provider response");
  });
  expect(s.shortlist).toEqual([]);
  expect(s.briefs).toEqual([]);
  expect(JSON.stringify(s)).not.toContain("SECRET");
  expect(s.sources).toHaveLength(6);
});
it("persists an idempotent isolated snapshot with no pilot or publishing writes", async () => {
  const before = await rpc("read_newsroom");
  const discovery = await rpc("read_discovery_state");
  const control = await rpc("read_control");
  const first = await runCreatorDiscovery(rpc, now, fetcher);
  expect(first).toMatchObject({
    status: "STORY_BRIEFS_ONLY",
    publication_candidates: 0,
    sources_healthy: 6,
  });
  expect(await runCreatorDiscovery(rpc, now, fetcher)).toMatchObject({
    status: "ALREADY_CLAIMED",
  });
  expect(await rpc("read_newsroom")).toEqual(before);
  expect(await rpc("read_discovery_state")).toEqual(discovery);
  expect(await rpc("read_control")).toEqual(control);
  expect(JSON.stringify(await rpc("read_creator_runs"))).not.toContain(
    '"owner"',
  );
  await expect(
    rpc("finish_creator_run", {
      p_slot: now.slice(0, 13),
      p_owner: crypto.randomUUID(),
      p_snapshot: {},
    }),
  ).rejects.toThrow();
});
it("rejects anonymous and authenticated direct DB access", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(
      db.query("select * from creator_discovery_runs"),
    ).rejects.toThrow();
    await expect(db.query("select read_creator_runs()")).rejects.toThrow();
    await db.exec("reset role");
  }
});
