import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  controlAction,
  controlSnapshot,
  readControl,
  accounts,
  readiness,
  launchReadiness,
  actions,
  editorialContext,
} from "../src/control/service";
import {
  quality,
  transition,
  workerAvailable,
  type ControlState,
  type Content,
  type Entity,
} from "../src/control/model";
import { providerAdapter } from "../src/control/providers";
import { projectExport, csv } from "../src/control/export";
import { signup, unsubscribe, publicRecords } from "../src/control/public";
import { workerIdentity } from "../src/production/protocol";
import { applyCommand } from "../src/domain/workflow";
let db: PGlite, rpc: Rpc;
const run = (command: unknown) =>
  controlAction(rpc, command, "Daniel · demo", true);
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
  const b = await run({
    action: "brand_save",
    name: "DEMO brand",
    positioning: "DEMO applied AI",
    audience: "Operators",
    pillars: ["AI at work"],
    tone: ["Specific"],
    cta: "Inspect the evidence",
  });
  await run({ action: "brand_approve", id: b.id, confirmed: true });
}, 30000);
afterAll(async () => db.close());
async function fixture(platform = "x", format = "post") {
  const snap = await controlSnapshot(rpc, true),
    s = snap.stories.find((s) => s.status === "approved")!;
  const idea = await run({
    action: "idea_create",
    title: `DEMO ${crypto.randomUUID().slice(0, 6)}`,
    source: "story",
    story_id: s.id,
    provenance: "Fictional fixture, not live reporting",
  });
  await run({ action: "idea_transition", id: idea.id, target: "qualified" });
  await run({ action: "idea_transition", id: idea.id, target: "selected" });
  const c = await run({
    action: "content_create",
    idea_id: idea.id,
    platform,
    format,
    purpose: "Demonstrate a guarded pipeline",
  });
  await run({ action: "content_bind", id: c.id, draft_id: s.active_draft_id });
  await run({
    action: "content_freshness",
    id: c.id,
    evergreen: true,
    fresh_until: null,
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id: c.id,
    target: "review",
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id: c.id,
    target: "approved",
    confirmed: true,
  });
  return { id: c.id!, s };
}
async function packageFor(
  id: string,
  graphics: string[] = [],
  caption = "DEMO: inspect the evidence before drawing conclusions.",
) {
  const p = await run({
    action: "package_create",
    id,
    caption,
    title: "DEMO evidence",
    cta: "Inspect",
    thread: [],
    graphic_ids: graphics,
  });
  await run({ action: "package_approve", id: p.id, confirmed: true });
  return p.id!;
}
it("persistent brand approval is versioned and approved-only generation context excludes suggested takes", async () => {
  await run({
    action: "take_suggest",
    text: "DEMO hypothesis",
    topic: "operators",
    rationale: "To test",
    source_ids: [],
  });
  const ctx = editorialContext(await readControl(rpc, true), "operators", "x");
  expect(ctx.brand_version).toBe(2);
  expect(ctx.approved_takes).toEqual([]);
  expect(ctx.rules.length).toBeGreaterThan(4);
});
it("no AI or worker action can silently approve a take", async () => {
  const t = await run({
    action: "take_suggest",
    text: "DEMO hypothesis 2",
    topic: "test",
    rationale: "No results",
    source_ids: [],
  });
  await expect(
    run({
      action: "take_decide",
      id: t.id,
      decision: "approved",
      reason: "Unconfirmed",
    }),
  ).rejects.toThrow();
  await expect(
    controlAction(
      rpc,
      {
        action: "take_decide",
        id: t.id,
        decision: "approved",
        reason: "Unconfirmed",
        confirmed: true,
      },
      "local-worker",
      true,
    ),
  ).rejects.toThrow("Human");
  const state = await readControl(rpc, true);
  expect(
    state.entities.find((e) => e.id === t.id)?.data.approved_by,
  ).toBeNull();
});
it("story rejection is a persistent editorial outcome, not a runtime failure", async () => {
  const s = (await controlSnapshot(rpc, true)).stories[0];
  const e = await run({
    action: "story_reject",
    story_id: s.id,
    reason: "Not selected for publication",
    confirmed: true,
  });
  expect(
    (await readControl(rpc, true)).entities.find((x) => x.id === e.id)?.data,
  ).toMatchObject({ status: "editorially_rejected", system_failure: false });
});
it("central state machines reject skipped approval", () => {
  expect(() => transition("content", "planned", "approved")).toThrow("Invalid");
  expect(() => transition("newsletter", "drafting", "approved")).toThrow();
});
it("competitor observations require original contribution before qualification", async () => {
  const e = await run({
    action: "idea_create",
    title: "DEMO observation",
    source: "competitor",
    provenance: "Public observation",
    originality: "",
  });
  await expect(
    run({ action: "idea_transition", id: e.id, target: "qualified" }),
  ).rejects.toThrow("originality");
});
it("accounts remain NOT_CREATED and providers fail without fabricated capabilities", async () => {
  expect(
    accounts(await readControl(rpc, true)).every(
      (a) => a.status === "not_created" && a.capabilities.length === 0,
    ),
  ).toBe(true);
  for (const name of [
    "instagram",
    "tiktok",
    "x",
    "youtube",
    "beehiiv",
  ] as const) {
    expect(() => providerAdapter(name).validateConnection()).toThrow(
      "authorization",
    );
    expect(() => providerAdapter(name).fetchMetrics()).toThrow();
  }
});
it("news approval requires current explicit evidence review", async () => {
  const { id, s } = await fixture();
  await run({
    action: "content_transition",
    id,
    target: "drafting",
    confirmed: true,
  });
  await run({ action: "content_bind", id, draft_id: s.active_draft_id });
  await run({
    action: "content_freshness",
    id,
    evergreen: false,
    fresh_until: new Date(Date.now() + 3600000).toISOString(),
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id,
    target: "review",
    confirmed: true,
  });
  await expect(
    run({
      action: "content_transition",
      id,
      target: "approved",
      confirmed: true,
    }),
  ).rejects.toThrow("revalidated");
  await run({
    action: "claim_revalidate",
    id,
    source_ids: [s.sources[0].id],
    notes: "DEMO source reviewed",
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id,
    target: "approved",
    confirmed: true,
  });
});
it("media/content binding rejects cross-story drafts", async () => {
  const { id } = await fixture();
  const stories = (await controlSnapshot(rpc, true)).stories,
    other = stories.find((s) => s.status === "scheduled")!;
  await expect(
    run({ action: "content_bind", id, draft_id: other.active_draft_id }),
  ).rejects.toThrow("belong");
});
it("real SVG renderer has provenance, persisted outputs and checksum; rights initially blocked", async () => {
  const { id, s } = await fixture();
  const g = await run({
    action: "graphic_queue",
    content_id: id,
    template: "cover",
    aspect: "9:16",
    headline: "DEMO evidence",
    text: "A proposed test, no measured outcome.",
    source_ids: [s.sources[0].id],
    slides: [],
  });
  await run({ action: "graphics_process" });
  const state = await readControl(rpc, true),
    graphic = state.entities.find((e) => e.id === g.id)!;
  expect(graphic.data.status).toBe("rendered");
  expect(graphic.data.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((graphic.data.outputs as { svg: string }[])[0].svg).toContain(s.id);
  const p = await packageFor(id, [g.id!]);
  await expect(
    run({ action: "content_final", id, package_id: p, confirmed: true }),
  ).rejects.toThrow("rights");
  await run({
    action: "graphic_clear",
    id: g.id,
    basis: "Original typographic demo using fictional source, owned",
    scope: "x",
    confirmed: true,
  });
  await expect(
    run({ action: "content_final", id, package_id: p, confirmed: true }),
  ).rejects.toThrow("stale");
  const cleared = (await readControl(rpc, true)).entities.find(
    (e) => e.id === g.id,
  )!;
  expect((cleared.data.outputs as { svg: string }[])[0].svg).toContain(
    "brainos-clearance",
  );
  expect((cleared.data.outputs as { svg: string }[])[0].svg).toContain(
    "USO REVISADO",
  );
  const newer = await packageFor(id, [g.id!]);
  await run({
    action: "content_final",
    id,
    package_id: newer,
    confirmed: true,
  });
});
it("final approval binds the exact platform package, not interchangeable copy", async () => {
  const { id } = await fixture(),
    p = await packageFor(id);
  await run({ action: "content_final", id, package_id: p, confirmed: true });
  const newer = await packageFor(id, [], "DEMO different platform copy");
  await expect(
    run({
      action: "distribution_queue",
      package_id: newer,
      due_at: new Date().toISOString(),
      confirmed: true,
    }),
  ).rejects.toThrow("Exact final");
});
it("disconnected accounts produce blocked durable idempotent distribution jobs", async () => {
  const { id } = await fixture(),
    p = await packageFor(id);
  await run({ action: "content_final", id, package_id: p, confirmed: true });
  for (let i = 0; i < 2; i++)
    await run({
      action: "distribution_queue",
      package_id: p,
      due_at: new Date().toISOString(),
      confirmed: true,
    });
  const jobs = (await readControl(rpc, true)).jobs.filter(
    (j) => j.entity_id === p && j.kind === "distribution",
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].status).toBe("blocked");
  expect(jobs[0].error).toContain("not_created");
});
it("end-to-end demo schedules +24h/+72h/+7d only after simulated publication", async () => {
  const { id } = await fixture(),
    p = await packageFor(id);
  await run({ action: "content_final", id, package_id: p, confirmed: true });
  const before = await readControl(rpc, true);
  expect(
    before.jobs.filter((j) => j.entity_id === p && j.kind === "analytics"),
  ).toHaveLength(0);
  const pub = await run({
    action: "publication_demo",
    package_id: p,
    confirmed: true,
  });
  const state = await readControl(rpc, true),
    record = state.entities.find((e) => e.id === pub.id)!,
    jobs = state.jobs.filter((j) => j.entity_id === pub.id);
  expect(record.data.simulated).toBe(true);
  expect(jobs).toHaveLength(3);
  expect(
    jobs.map(
      (j) =>
        (Date.parse(j.due_at) - Date.parse(String(record.data.published_at))) /
        3600000,
    ),
  ).toEqual([24, 72, 168]);
  await expect(
    run({ action: "publication_demo", package_id: p, confirmed: true }),
  ).rejects.toThrow("already recorded");
});
it("unavailable analytics are BLOCKED, never successful or fake metrics", async () => {
  await db.exec("update control_jobs set due_at=now() where kind='analytics'");
  await run({ action: "analytics_process" });
  const state = await readControl(rpc, true);
  expect(
    state.jobs
      .filter((j) => j.kind === "analytics")
      .every((j) => j.status === "blocked"),
  ).toBe(true);
});
it("learning creates a suggested next idea from raw observed metrics with sample warnings", async () => {
  const { id } = await fixture(),
    p = await packageFor(id);
  await run({ action: "content_final", id, package_id: p, confirmed: true });
  const pub = await run({
    action: "publication_demo",
    package_id: p,
    confirmed: true,
  });
  await run({
    action: "metrics_record",
    publication_id: pub.id,
    metrics: { views: 15 },
    raw: { views: 15, source: "DEMO fixture" },
    confirmed: true,
  });
  await run({
    action: "performance_review",
    id: pub.id,
    notes: "DEMO descriptive observation, no causality",
  });
  const state = await readControl(rpc, true),
    review = state.entities.find(
      (e) => e.kind === "review" && e.data.publication_id === pub.id,
    )!;
  expect(review.data.causality).toBe(false);
  expect(JSON.stringify(review.data.comparisons)).toContain("Insufficient");
  expect(
    state.entities.some(
      (e) =>
        e.kind === "idea" &&
        e.parent_id === pub.id &&
        e.data.status === "captured",
    ),
  ).toBe(true);
});
it("launch readiness is derived from actual dependencies, including uncreated account", async () => {
  const { id } = await fixture(),
    campaign = await run({
      action: "campaign_create",
      name: "DEMO launch",
      content_ids: [id],
    });
  const snap = await controlSnapshot(rpc, true),
    e = snap.state.entities.find((e) => e.id === campaign.id)!;
  const slots = launchReadiness(e, snap.state, snap.stories, snap.production);
  expect(slots[0].ready).toBe(false);
  expect(slots[0].issues.join(" ")).toContain("not_created");
  expect(slots[0].issues.join(" ")).toContain("package approval");
});
it("newsletter approval binds section versions, changes create unapproved issue revision", async () => {
  const { id } = await fixture("beehiiv", "newsletter"),
    p = await packageFor(id);
  const issue = await run({
    action: "newsletter_create",
    title: "DEMO issue",
    opening: "DEMO notes",
    package_ids: [p],
  });
  await run({ action: "newsletter_review", id: issue.id });
  await run({ action: "newsletter_approve", id: issue.id, confirmed: true });
  const newer = await run({
    action: "newsletter_revise",
    id: issue.id,
    title: "DEMO next revision",
    opening: "Changed",
  });
  const state = await readControl(rpc, true);
  expect(state.entities.find((e) => e.id === newer.id)?.data).toMatchObject({
    status: "drafting",
    approved_by: null,
    revision: 2,
  });
  expect(state.entities.find((e) => e.id === issue.id)?.data.status).toBe(
    "approved",
  );
});
it("unapproved sources cannot enter the public read model", async () => {
  const { id } = await fixture();
  await expect(
    run({
      action: "materialize_public",
      id,
      kind: "content",
      title: "DEMO public",
      description: "",
      body: "",
      url: null,
      confirmed: true,
    }),
  ).rejects.toThrow();
  expect(await publicRecords(rpc)).toEqual([]);
});
it("narrow approved public materialization excludes all private metadata", async () => {
  const state = await readControl(rpc, true),
    brand = state.entities.find(
      (e) => e.kind === "brand" && e.data.status === "active",
    )!;
  await run({
    action: "materialize_public",
    id: brand.id,
    kind: "profile",
    title: "DEMO profile",
    description: "Approved public text",
    body: "",
    url: null,
    confirmed: true,
  });
  const records = await publicRecords(rpc, true);
  expect(Object.keys(records[0]).sort()).toEqual([
    "body",
    "description",
    "id",
    "kind",
    "title",
    "url",
  ]);
  expect(JSON.stringify(records)).not.toContain("approved_by");
  const privileges = await db.query<{ allowed: boolean }>(
    "select has_column_privilege('anon','public_surface','approved_by','SELECT') or has_function_privilege('anon','read_control()','EXECUTE') or has_table_privilege('anon','provider_credentials','SELECT') as allowed",
  );
  expect(privileges.rows[0].allowed).toBe(false);
  await db.exec("set role anon");
  try {
    expect(
      (await db.query("select id,title from public_surface")).rows,
    ).toEqual([]);
    await expect(
      db.query("select approved_by from public_surface"),
    ).rejects.toThrow("permission");
  } finally {
    await db.exec("reset role");
  }
});
it("subscriber intake requires explicit consent and supports withdrawal without email sending", async () => {
  await expect(signup(rpc, "demo@example.com", false)).rejects.toThrow(
    "consent",
  );
  const token = await signup(rpc, "demo@example.com", true);
  await unsubscribe(rpc, token);
  const r = await db.query<{ status: string }>(
    "select status from subscriber_intake where email='demo@example.com'",
  );
  expect(r.rows[0].status).toBe("unsubscribed");
});
it("portable exports remove nested secrets and neutralize spreadsheet formula injection", async () => {
  const snap = await controlSnapshot(rpc, true);
  const exportData = projectExport(
    {
      ...snap.state,
      entities: [
        ...snap.state.entities,
        {
          id: crypto.randomUUID(),
          kind: "review",
          version: 1,
          is_demo: true,
          story_id: null,
          draft_id: null,
          parent_id: null,
          data: {
            token: "hidden",
            nested: { password: "hidden", ciphertext: "hidden", count: 2 },
          },
        },
      ],
    },
    snap.stories,
    snap.production,
  );
  expect(JSON.stringify(exportData)).not.toContain("hidden");
  expect(csv([{ title: "=HYPERLINK(1)", note: "Safe" }])).toContain(
    "'=HYPERLINK",
  );
});
it("worker protocol mismatch is rejected, idle health uses the actual heartbeat window", () => {
  expect(() => workerIdentity({ protocol: 2 })).toThrow("mismatch");
  const state = {
    workers: [
      {
        id: "mac",
        protocol: 1,
        version: "1.1",
        capabilities: ["render"],
        active_job: null,
        last_seen: new Date().toISOString(),
      },
    ],
  } as ControlState;
  expect(workerAvailable(state)).toBe(true);
  expect(workerAvailable(state, Date.now() + 700000)).toBe(false);
});
it("stale leases recover without duplicate jobs; expired tokens cannot complete", async () => {
  const { id, s } = await fixture();
  const g = await run({
    action: "graphic_queue",
    content_id: id,
    template: "news",
    aspect: "4:5",
    headline: "DEMO",
    text: "Demo",
    source_ids: [s.sources[0].id],
    slides: [],
  });
  const one = (await rpc("claim_control_job", {
    p_kind: "graphic",
    p_demo: true,
  })) as { id: string; lease_token: string };
  await db.query(
    "update control_jobs set leased_until=now()-interval '1 second' where id=$1",
    [one.id],
  );
  const two = (await rpc("claim_control_job", {
    p_kind: "graphic",
    p_demo: true,
  })) as { id: string; lease_token: string };
  expect(two.id).toBe(one.id);
  expect(two.lease_token).not.toBe(one.lease_token);
  await expect(
    rpc("finish_control_job", {
      p_id: one.id,
      p_token: one.lease_token,
      p_status: "succeeded",
      p_result: {},
      p_error: null,
      p_retryable: false,
    }),
  ).rejects.toThrow("lease lost");
  expect(g.id).toBeTruthy();
});
it("mobile action queue is built from actual pending records", async () => {
  const s = await controlSnapshot(rpc, true),
    queue = actions(s.state, s.stories, s.production);
  expect(queue.some((a) => a.kind === "take")).toBe(true);
  expect(queue.some((a) => a.kind === "job")).toBe(true);
  expect(queue.every((a) => a.href.startsWith("/"))).toBe(true);
});
it("editing exact approved draft invalidates downstream readiness and recording binding", async () => {
  const { id, s } = await fixture(),
    p = await packageFor(id);
  await run({ action: "content_final", id, package_id: p, confirmed: true });
  await run({
    action: "materialize_public",
    id,
    kind: "content",
    title: "DEMO public approved copy",
    description: "Demo only",
    body: "",
    url: null,
    confirmed: true,
  });
  expect((await publicRecords(rpc, true)).some((r) => r.id === id)).toBe(true);
  const draft = s.drafts.find((d) => d.id === s.active_draft_id)!;
  const updated = await applyCommand(
    s,
    {
      type: "edit_draft",
      draftId: draft.id,
      hook: "DEMO revised",
      body: draft.body,
      cta: draft.cta,
      shotNotes: draft.shot_notes,
      assetIds: draft.asset_ids,
    },
    "Daniel · demo",
  );
  await rpc("save_story", { p_story: updated, p_expected_version: s.version });
  const snap = await controlSnapshot(rpc, true),
    c = snap.state.entities.find(
      (e) => e.id === id,
    ) as unknown as Entity<Content>;
  expect(
    readiness(c, snap.state, snap.stories, snap.production, p).issues.join(" "),
  ).toContain("exact approved");
  expect(snap.state.entities.find((e) => e.id === p)?.data.status).toBe(
    "invalidated",
  );
  expect(c.data.final_approval).toBeNull();
  expect((await publicRecords(rpc, true)).some((r) => r.id === id)).toBe(false);
});
it("quality runs persist automatically for new draft revisions and deterministic spans are useful", async () => {
  const state = await readControl(rpc, true);
  expect(
    state.entities.filter((e) => e.kind === "quality").length,
  ).toBeGreaterThan(3);
  const q = quality("No es magia, es trabajo. Yo probé esto. En conclusión.");
  expect(
    q.some((i) => i.rule === "false_experience" && i.severity === "high"),
  ).toBe(true);
  expect(q.every((i) => i.end > i.start)).toBe(true);
});
it("graphics output commits are fenced by the active lease and are atomic with completion", async () => {
  const snap = await controlSnapshot(rpc, true),
    story = snap.stories.find((s) => s.status === "scheduled")!;
  const id = crypto.randomUUID();
  const state = await readControl(rpc, true);
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        id,
        kind: "graphic",
        version: 1,
        is_demo: true,
        story_id: story.id,
        draft_id: story.active_draft_id,
        parent_id: null,
        data: { status: "queued" },
      },
    ],
    p_jobs: [
      {
        id: crypto.randomUUID(),
        kind: "graphic",
        entity_id: id,
        entity_version: 1,
        is_demo: true,
        idempotency_key: `fence:${id}`,
        status: "queued",
        due_at: new Date().toISOString(),
        input: {},
        error: null,
        retryable: false,
      },
    ],
    p_public: [],
    p_actor: "DEMO verifier",
  });
  const job = (await rpc("claim_control_job", {
    p_kind: "graphic",
    p_demo: true,
  })) as { id: string; lease_token: string };
  await db.query(
    "update control_jobs set leased_until=now()-interval '1 second' where id=$1",
    [job.id],
  );
  const current = await readControl(rpc, true),
    entity = current.entities.find((e) => e.id === id)!;
  await expect(
    rpc("commit_control", {
      p_epoch: current.epoch,
      p_entities: [
        {
          ...entity,
          version: 2,
          data: { status: "rendered", sha256: "a".repeat(64) },
        },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "graphics-renderer",
      p_lease_id: job.id,
      p_lease_token: job.lease_token,
    }),
  ).rejects.toThrow("lease lost");
  expect(
    (await readControl(rpc, true)).entities.find((e) => e.id === id)?.data
      .status,
  ).toBe("queued");
});
it("transport errors and spoofed preview origins remain fail-closed", async () => {
  const { sameOrigin } = await import("../src/server/request");
  const prior = {
    origin: process.env.CONTENT_OS_ORIGIN,
    vercel: process.env.VERCEL_URL,
  };
  process.env.CONTENT_OS_ORIGIN = "https://canonical.example";
  process.env.VERCEL_URL = "preview.example";
  try {
    expect(
      sameOrigin(
        new Request("https://preview.example/api/control", {
          headers: {
            origin: "https://preview.example",
            host: "preview.example",
          },
        }),
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        new Request("https://preview.example/api/control", {
          headers: {
            origin: "https://attacker.example",
            host: "preview.example",
          },
        }),
      ),
    ).toBe(false);
  } finally {
    if (prior.origin === undefined) delete process.env.CONTENT_OS_ORIGIN;
    else process.env.CONTENT_OS_ORIGIN = prior.origin;
    if (prior.vercel === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = prior.vercel;
  }
});
it("all nine programmatic templates render real aspect-specific SVGs with provenance", async () => {
  const { renderGraphic } = await import("../src/control/graphics"),
    snap = await controlSnapshot(rpc, true),
    story = snap.stories.find((s) => s.status === "scheduled")!;
  for (const template of [
    "source",
    "stat",
    "comparison",
    "quote",
    "news",
    "carousel_title",
    "carousel_body",
    "build_result",
    "cover",
  ]) {
    for (const aspect of ["9:16", "1:1", "4:5", "16:9"]) {
      const evidence = structuredClone(story);
      evidence.sources[0].excerpt =
        "DEMO: 12 illustrative tasks, no measured result.";
      const rendered = renderGraphic(evidence, crypto.randomUUID(), 2, {
        template,
        aspect,
        headline: "DEMO evidence",
        text:
          template === "quote" || template === "stat"
            ? evidence.sources[0].excerpt
            : "DEMO text",
        source_ids:
          template === "comparison"
            ? evidence.sources.slice(0, 2).map((s) => s.id)
            : [evidence.sources[0].id],
        slides: template.startsWith("carousel")
          ? [
              { headline: "DEMO slide 1", body: "A proposal" },
              { headline: "DEMO slide 2", body: "Inspect sources" },
            ]
          : [],
      });
      expect(rendered.outputs[0].svg).toContain("<svg");
      expect(rendered.outputs[0].svg).toContain(story.id);
      expect(rendered.rights).toBe("unknown");
      expect(rendered.outputs.length).toBe(
        template.startsWith("carousel") ? 2 : 1,
      );
    }
  }
});
it("an old cover cannot silently accompany changed platform headline copy", async () => {
  const { renderGraphic } = await import("../src/control/graphics"),
    snap = await controlSnapshot(rpc, true),
    s = snap.stories.find((s) => s.status === "scheduled")!,
    brand = snap.state.entities.find(
      (e) => e.kind === "brand" && e.data.status === "active",
    )!;
  const { readiness } = await import("../src/control/service");
  const c = {
    id: crypto.randomUUID(),
    kind: "content",
    version: 1,
    story_id: s.id,
    draft_id: s.active_draft_id,
    parent_id: null,
    is_demo: true,
    data: {
      title: "Demo",
      format: "post",
      platform: "x",
      content_state: "approved",
      evergreen: true,
      draft_revision: s.drafts.find((d) => d.id === s.active_draft_id)!
        .revision,
      take_id: null,
      production_id: null,
    },
  } as Entity<Content>;
  const draft = s.drafts.find((d) => d.id === s.active_draft_id)!;
  const graphic = {
    id: crypto.randomUUID(),
    kind: "graphic",
    version: 2,
    story_id: s.id,
    draft_id: draft.id,
    parent_id: c.id,
    is_demo: true,
    data: {
      template: "cover",
      input: { headline: "Old headline" },
      scope: "x",
      ...renderGraphic(s, c.id, draft.revision, {
        template: "cover",
        aspect: "9:16",
        headline: "Old headline",
        text: "DEMO",
        source_ids: [s.sources[0].id],
        slides: [],
      }),
    },
  } as Entity;
  graphic.data.rights = "cleared";
  graphic.data.publishable = true;
  const p = {
    id: crypto.randomUUID(),
    kind: "package",
    version: 2,
    story_id: s.id,
    draft_id: draft.id,
    parent_id: c.id,
    is_demo: true,
    data: {
      status: "approved",
      title: "Changed headline",
      caption: "DEMO",
      thread: [],
      content_id: c.id,
      brand_id: brand.id,
      brand_version: brand.version,
      platform: "x",
      graphic_ids: [graphic.id],
      fingerprint: "different",
    },
  } as Entity;
  const state = {
    ...snap.state,
    entities: [...snap.state.entities, c as unknown as Entity, graphic, p],
  };
  expect(
    readiness(c, state, snap.stories, snap.production, p.id).issues.join(" "),
  ).toContain("Cover headline differs");
});
it("custom voice rules preserve complete SQL excerpts even with internal capture groups", async () => {
  const b = await run({
    action: "brand_save",
    name: "DEMO custom rule",
    positioning: "Evidence first",
    audience: "Operators",
    pillars: ["AI at work"],
    tone: ["Specific"],
    cta: "Inspect",
    banned_patterns: ["No es (magia), es trabajo\\."],
  });
  await run({ action: "brand_approve", id: b.id, confirmed: true });
  const snap = await controlSnapshot(rpc, true),
    s = snap.stories.find((s) => s.status === "scheduled")!,
    d = s.drafts.find((d) => d.id === s.active_draft_id)!;
  const changed = await applyCommand(
    s,
    {
      type: "edit_draft",
      draftId: d.id,
      hook: d.hook,
      body: "DEMO: No es magia, es trabajo.",
      cta: d.cta,
      shotNotes: d.shot_notes,
      assetIds: d.asset_ids,
    },
    "DEMO editor",
  );
  await rpc("save_story", { p_story: changed, p_expected_version: s.version });
  const state = await readControl(rpc, true),
    runRecord = state.entities.find(
      (e) => e.kind === "quality" && e.draft_id === changed.active_draft_id,
    )!;
  expect((runRecord.data.issues as { excerpt: string }[])[0].excerpt).toBe(
    "No es magia, es trabajo.",
  );
});
