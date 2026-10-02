import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  controlAction,
  controlSnapshot,
  readControl,
} from "../src/control/service";
import { publicAttribution } from "../src/providers/attribution";
import type { Entity, Package, Provider } from "../src/control/model";

let db: PGlite;
let rpc: Rpc;
const run = (command: unknown) =>
  controlAction(rpc, command, "Daniel demo", true);
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
  const brand = await run({
    action: "brand_save",
    name: "DEMO",
    positioning: "Applied AI",
    audience: "Operators",
    pillars: ["Evidence"],
    tone: ["Specific"],
    cta: "Inspect",
  });
  await run({ action: "brand_approve", id: brand.id, confirmed: true });
});
afterAll(async () => db.close());

async function content(platform: Provider) {
  const story = (await controlSnapshot(rpc, true)).stories.find(
    (s) => s.status === "approved",
  )!;
  const idea = await run({
    action: "idea_create",
    title: "DEMO package",
    source: "story",
    story_id: story.id,
    provenance: "Fictional test fixture",
  });
  await run({ action: "idea_transition", id: idea.id, target: "qualified" });
  await run({ action: "idea_transition", id: idea.id, target: "selected" });
  const created = await run({
    action: "content_create",
    idea_id: idea.id,
    platform,
    format: "post",
    purpose: "Verify approved copy",
  });
  await run({
    action: "content_bind",
    id: created.id,
    draft_id: story.active_draft_id,
  });
  return { id: created.id!, story };
}
async function createPackage(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await run({
    action: "package_create",
    id,
    title: "DEMO evidence",
    caption: "Evidence before conclusions.",
    cta: "Read the full analysis.",
    thread: [],
    graphic_ids: [],
    ...overrides,
  });
  return (await readControl(rpc, true)).entities.find(
    (e) => e.id === result.id,
  ) as unknown as Entity<Package>;
}

for (const platform of ["instagram", "tiktok", "youtube", "beehiiv"] as const)
  it(`${platform}: shows CTA and primary-source attribution in the persisted draft before approval`, async () => {
    const fixture = await content(platform),
      attribution = publicAttribution(fixture.story, platform),
      pkg = await createPackage(fixture.id);
    expect(pkg.data.status).toBe("draft");
    expect(pkg.data.caption).toContain("Read the full analysis.");
    for (const url of attribution.links)
      expect(pkg.data.caption).toContain(url);
    await run({ action: "package_approve", id: pkg.id, confirmed: true });
    const approved = (await readControl(rpc, true)).entities.find(
      (e) => e.id === pkg.id,
    )!;
    expect(approved.data.status).toBe("approved");
    expect(approved.data.caption).toBe(pkg.data.caption);
  });

it("does not duplicate CTA or existing source links, including tracked versions", async () => {
  const fixture = await content("instagram"),
    attribution = publicAttribution(fixture.story, "instagram"),
    caption = `Evidence before conclusions. Read the full analysis.\n${attribution.links.map((url) => `${url}?utm_source=editor`).join("\n")}`,
    pkg = await createPackage(fixture.id, { caption });
  expect(pkg.data.caption).toBe(caption);
});

it("X includes additions in the actual bounded thread, even when a thread overrides caption", async () => {
  const fixture = await content("x"),
    pkg = await createPackage(fixture.id, {
      caption: "Unused summary",
      thread: ["a".repeat(280), "b".repeat(280)],
    });
  expect(pkg.data.caption).toBe("a".repeat(280));
  expect(pkg.data.thread.slice(0, 2)).toEqual([
    "a".repeat(280),
    "b".repeat(280),
  ]);
  expect(pkg.data.thread.every((post) => post.length <= 280)).toBe(true);
  expect(pkg.data.thread.join("\n")).toContain("Read the full analysis.");
  for (const url of pkg.data.source_links)
    expect(pkg.data.thread.join("\n")).toContain(url);
});

it("X expands a full single caption into a reviewable thread without dropping copy", async () => {
  const fixture = await content("x"),
    pkg = await createPackage(fixture.id, { caption: "a".repeat(280) });
  expect(pkg.data.thread[0]).toBe(pkg.data.caption);
  expect(pkg.data.thread.length).toBeGreaterThan(1);
  expect(pkg.data.thread.join("\n")).toContain("Read the full analysis.");
});

it("validates final composed copy and rejects generated thread overflow", async () => {
  const instagram = await content("instagram");
  await expect(
    createPackage(instagram.id, { caption: "a".repeat(2200) }),
  ).rejects.toThrow("caption exceeds 2200");
  const x = await content("x");
  await expect(
    createPackage(x.id, {
      thread: Array.from({ length: 25 }, () => "a".repeat(280)),
    }),
  ).rejects.toThrow("at most 25");
  const youtube = await content("youtube");
  await expect(
    createPackage(youtube.id, { title: "a".repeat(101) }),
  ).rejects.toThrow("title exceeds 100");
});

it("counts X image slides inside graphics, accepting four and rejecting five before approval", async () => {
  const fixture = await content("x"),
    graphicId = crypto.randomUUID();
  const graphic: Entity = {
    id: graphicId,
    kind: "graphic",
    version: 1,
    story_id: fixture.story.id,
    draft_id: fixture.story.active_draft_id,
    parent_id: fixture.id,
    is_demo: true,
    data: {
      outputs: Array.from({ length: 4 }, (_, slide) => ({ slide })),
      sha256: "fixture-four",
    },
  };
  let state = await readControl(rpc, true);
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [graphic],
    p_jobs: [],
    p_public: [],
    p_actor: "fixture",
  });
  expect(
    (await createPackage(fixture.id, { graphic_ids: [graphicId] })).data
      .graphic_ids,
  ).toEqual([graphicId]);
  state = await readControl(rpc, true);
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        ...graphic,
        version: 2,
        data: {
          ...graphic.data,
          outputs: Array.from({ length: 5 }, (_, slide) => ({ slide })),
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "fixture",
  });
  await expect(
    createPackage(fixture.id, { graphic_ids: [graphicId] }),
  ).rejects.toThrow("at most 4 approved images");
});
