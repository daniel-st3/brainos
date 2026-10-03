import { creativeHash as hash } from "../src/creative/fingerprint";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { controlAction, controlSnapshot } from "../src/control/service";
import {
  type Entity,
  type Content,
  type ControlState,
} from "../src/control/model";
import type { Story } from "../src/domain/types";
import {
  creativePackageSchema,
  captionSpecSchema,
  type CreativePackage,
} from "../src/creative/schema";
import {
  currentCreative,
  importedCandidate,
  creativeRenderIssues,
  type CreativeRecord,
  type CreativeMedia,
} from "../src/creative/model";
import { creativeTokens } from "../src/creative/tokens";
import { currentCreativeJob, creativeJob } from "../src/creative/jobs";
import { canvaHandoff } from "../src/creative/handoff";
import { AssetResolverRegistry } from "../src/creative/providers";
import {
  renderCreative,
  type CreativeRenderer,
} from "../src/creative/renderers";
import { readFileSync } from "node:fs";

let db: PGlite,
  rpc: Rpc,
  content: Entity<Content>,
  stories: Story[],
  state: ControlState;
const actor = "Daniel · TEST fixture only";
const now = "2026-10-03T15:00:00.000Z";
const run = (command: unknown, epoch?: number) =>
  controlAction(rpc, command, actor, true, epoch);
const uid = () => crypto.randomUUID();
function fixture(): CreativePackage {
  const story = stories.find((s) => s.id === content.story_id)!;
  const draft = story.drafts.find((d) => d.id === content.draft_id)!;
  return creativePackageSchema.parse({
    schema_version: 1,
    grammar_status: "PENDING_C2_CREATIVE_VALIDATION",
    binding: {
      story_id: story.id,
      content_id: content.id,
      content_version: content.version,
      angle_id: draft.angle_id,
      draft_id: draft.id,
      draft_revision: draft.revision,
    },
    brief: {
      schema_version: 1,
      id: uid(),
      revision: 1,
      objective: "TEST only; not a DVNI creative decision",
      audience: "Fixture reviewers",
      thesis: "Test provenance",
      exact_copy: { headline: "TEST fixture" },
      sources: [{ source_id: story.sources[0].id }],
    },
    visual: {
      schema_version: 1,
      visual_thesis: "TEST unspecified aesthetic",
      composition: "Caller-supplied composition",
      typography: [],
      aspect_ratios: ["4:5"],
      fallback_strategy: "Stop for a human decision",
    },
    carousel: {
      schema_version: 1,
      aspect_ratio: "4:5",
      scenes: [
        {
          id: uid(),
          type: "custom",
          copy: { headline: "TEST fixture" },
          hierarchy: ["headline"],
          composition: "No fixed template",
          asset_ids: [],
          typography: [],
          sources: [],
        },
      ],
    },
    captions: [],
    requirements: [],
    assets: [],
    handoffs: [],
  });
}
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
  const brand = await run({
    action: "brand_save",
    name: "TEST policy only",
    positioning: "Synthetic test",
    audience: "Test reviewers",
    pillars: ["Test"],
    tone: ["Specific"],
    cta: "Review the fixture",
  });
  await run({ action: "brand_approve", id: brand.id, confirmed: true });
  stories = (await controlSnapshot(rpc, true)).stories;
  const story = stories.find((s) => s.status === "approved")!;
  const idea = await run({
    action: "idea_create",
    title: "TEST creative preparation",
    source: "story",
    story_id: story.id,
    provenance: "Synthetic regression fixture",
  });
  await run({ action: "idea_transition", id: idea.id, target: "qualified" });
  await run({ action: "idea_transition", id: idea.id, target: "selected" });
  const result = await run({
    action: "content_create",
    idea_id: idea.id,
    platform: "instagram",
    format: "carousel",
    purpose: "TEST contracts, no generation",
  });
  await run({
    action: "content_bind",
    id: result.id,
    draft_id: story.active_draft_id,
  });
  state = (await controlSnapshot(rpc, true)).state;
  content = state.entities.find(
    (e) => e.id === result.id,
  ) as unknown as Entity<Content>;
}, 30000);
afterAll(async () => db.close());
describe("neutral creative contracts", () => {
  it("validates extensible v1 data without fonts, palette, accent or template defaults", () => {
    const p = fixture();
    expect(p.visual?.palette).toBeUndefined();
    expect(p.visual?.typography).toEqual([]);
    expect(creativeTokens(p.visual!)).toEqual({});
    expect(
      creativePackageSchema.safeParse({ ...p, schema_version: 2 }).success,
    ).toBe(false);
    expect(
      creativePackageSchema.safeParse({ ...p, template: "fixed-DVNI-template" })
        .success,
    ).toBe(false);
  });
  it("retains explicit light per-story palettes and independent scene composition", () => {
    const p = fixture();
    p.visual!.palette = {
      composition: "light",
      colors: [{ role: "paper", value: "#ffffff" }],
    };
    p.carousel!.scenes[0].composition = "Own art direction";
    expect(creativeTokens(p.visual!)).toEqual({
      "--creative-color-paper": "#ffffff",
    });
    expect(creativeTokens(p.visual!)).not.toHaveProperty(
      "--creative-color-accent",
    );
  });
  it("rejects invalid scene ordering, unknown assets and divergent motion scenes", () => {
    const p = fixture();
    p.carousel!.scenes.push(p.carousel!.scenes[0]);
    expect(creativePackageSchema.safeParse(p).success).toBe(false);
    const q = fixture();
    q.motion = {
      schema_version: 1,
      fps: 30,
      scenes: [
        {
          scene_id: uid(),
          duration_seconds: 2,
          direction: "TEST",
          reduced_motion_alternative: "Hold frame",
        },
      ],
      extensions: {},
    };
    expect(creativePackageSchema.safeParse(q).success).toBe(false);
    q.motion.scenes[0].scene_id = q.carousel!.scenes[0].id;
    expect(creativePackageSchema.safeParse(q).success).toBe(true);
  });
  it("stores independent platform captions and only referenced Daniel takes", () => {
    const p = fixture();
    for (const platform of [
      "instagram",
      "tiktok",
      "youtube_shorts",
      "x",
      "newsletter",
    ] as const)
      p.captions.push(
        captionSpecSchema.parse({
          schema_version: 1,
          platform,
          language: "es",
          hook: `TEST ${platform}`,
          body: "",
          context: "",
          cta: "",
          source_note: "",
          sources: [],
          hashtags: [],
          alt_text: "",
        }),
      );
    expect(
      new Set(creativePackageSchema.parse(p).captions.map((c) => c.hook)).size,
    ).toBe(5);
    p.captions.push(p.captions[0]);
    expect(creativePackageSchema.safeParse(p).success).toBe(false);
    p.captions.pop();
    p.captions[0].daniel_take = {
      id: uid(),
      version: 1,
      text: "Invented conviction",
    };
    expect(() => currentCreative(p, state, stories)).toThrow(
      "approved Daniel take",
    );
  });
  it("rejects wrong story, revision and unretained sources", () => {
    const p = fixture();
    p.binding.draft_revision++;
    expect(() => currentCreative(p, state, stories)).toThrow("stale");
    const q = fixture();
    q.binding.story_id = uid();
    expect(() => currentCreative(q, state, stories)).toThrow("stale");
    const r = fixture();
    r.brief.sources = [{ source_id: uid() }];
    expect(() => currentCreative(r, state, stories)).toThrow("retained");
  });
  it("isolates public compatibility tokens from internal UI and never imports them into creative code", () => {
    const css = readFileSync("src/app/public-presentation.css", "utf8");
    expect(css).toContain(".public-frame");
    expect(css).toContain("--public-preview-control-primary");
    expect(css).not.toContain("var(--accent-primary)");
    for (const file of ["tokens", "renderers", "schema", "providers"])
      expect(readFileSync(`src/creative/${file}.ts`, "utf8")).not.toMatch(
        /from ["'][^"']*(?:design-system|control\/graphics)|#31674b|#b6cc91/,
      );
  });
  it("has no implicit asset resolver network or paid fallback", () => {
    expect(() => new AssetResolverRegistry().get("wikimedia")).toThrow(
      "ASSET_PROVIDER_NOT_CONFIGURED",
    );
  });
});
describe("persisted creative workflows", () => {
  it("stale imported provenance or bytes block rendering even after authoritative rights clearance", () => {
    const p = fixture(),
      requirement = uid(),
      handoff = uid(),
      assetId = uid();
    p.requirements.push({
      id: requirement,
      description: "TEST source file",
      required: true,
      scene_ids: [],
      usage: "Test",
      rights_requirements: [],
      fallback_strategy: "Wait",
    });
    p.handoffs.push({
      id: handoff,
      provider: "chatgpt_manual",
      brief_id: p.brief.id,
      brief_revision: 1,
      requirement_id: requirement,
      request: "TEST only",
      prompt_reference: null,
      state: "WAITING_FOR_EXTERNAL_VISUAL",
      requested_at: now,
      candidate_id: null,
    });
    const media: CreativeMedia = {
      id: uid(),
      story_id: p.binding.story_id,
      draft_id: p.binding.draft_id,
      asset_id: assetId,
      file_id: "TEST/file.png",
      sha256: hash("TEST bytes"),
      mime_type: "image/png",
      created_at: now,
    };
    const candidate = importedCandidate(
      p,
      handoff,
      media,
      {
        requirement_id: requirement,
        generated_at: null,
        rights_usage_notes: "TEST human clearance",
      },
      now,
    );
    candidate.human_review = "accepted";
    candidate.rights_status = "cleared";
    p.assets.push(candidate);
    p.handoffs[0].candidate_id = candidate.id;
    p.handoffs[0].state = "EXTERNAL_VISUAL_IMPORTED";
    const authoritative = structuredClone(stories),
      story = authoritative.find((s) => s.id === p.binding.story_id)!;
    story.assets.push({
      id: assetId,
      story_id: story.id,
      draft_id: p.binding.draft_id,
      type: "image",
      title: "TEST source file",
      source_url: "https://test.invalid/file",
      storage_url: media.file_id,
      publisher: "TEST",
      retrieved_at: now,
      usage_basis: "TEST documented rights",
      attribution: "TEST",
      rights_status: "cleared",
      publishable: true,
      notes: "TEST only",
      cleared_by: actor,
      cleared_at: now,
    });
    story.drafts
      .find((d) => d.id === p.binding.draft_id)!
      .asset_ids.push(assetId);
    const record: CreativeRecord = {
      status: "approved",
      package: p,
      approval: { actor, at: now, fingerprint: hash(p) },
    };
    expect(creativeRenderIssues(record, state, authoritative, [media])).toEqual(
      [],
    );
    expect(
      creativeRenderIssues(record, state, authoritative, [
        { ...media, sha256: hash("Changed bytes") },
      ]).join(),
    ).toContain("checksum");
    p.assets[0].import_provenance!.brief_revision++;
    expect(
      creativeRenderIssues(record, state, authoritative, [media]).join(),
    ).toContain("stale");
  });
  it("saves, approves and revises exact specifications while preserving history and clearing approval", async () => {
    const p = fixture(),
      result = await run({ action: "creative_save", package: p });
    await run({ action: "creative_approve", id: result.id, confirmed: true });
    let snap = await controlSnapshot(rpc, true);
    const approved = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    expect(approved.data.approval?.fingerprint).toBe(hash(p));
    await expect(
      rpc("commit_control", {
        p_epoch: snap.state.epoch,
        p_entities: [
          {
            ...approved,
            version: approved.version + 1,
            data: {
              ...approved.data,
              package: {
                ...p,
                brief: { ...p.brief, thesis: "Changed without review" },
              },
            },
          },
        ],
        p_jobs: [],
        p_public: [],
        p_actor: actor,
      }),
    ).rejects.toThrow("immutable");
    p.brief.revision++;
    await run({ action: "creative_save", id: result.id, package: p });
    snap = await controlSnapshot(rpc, true);
    const revised = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    expect(revised.data.approval).toBeNull();
    expect(revised.data.status).toBe("draft");
    expect(
      creativeRenderIssues(revised.data, snap.state, snap.stories),
    ).toContain("Exact creative specification approval required");
    const history = await db.query<{ count: number }>(
      "select count(*)::int count from control_events where entity_id=$1",
      [result.id],
    );
    expect(history.rows[0].count).toBe(3);
  });
  it("jobs are inert, revision-bound and idempotent; retry/cancel does not execute generation", async () => {
    const result = await run({ action: "creative_save", package: fixture() });
    const a = await run({
      action: "creative_job_queue",
      id: result.id,
      operation: "GENERATE_VISUAL_SPEC",
    });
    const b = await run({
      action: "creative_job_queue",
      id: result.id,
      operation: "GENERATE_VISUAL_SPEC",
    });
    expect(a.id).toBe(b.id);
    let snap = await controlSnapshot(rpc, true);
    const job = snap.state.jobs.find((j) => j.id === a.id)!;
    const record = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    expect(job.status).toBe("blocked");
    expect(job.error).toContain("NOT_CONFIGURED");
    expect(currentCreativeJob(job, record)).toBe(true);
    expect(
      currentCreativeJob(job, { ...record, version: record.version + 1 }),
    ).toBe(false);
    expect(
      creativeJob(record, "RENDER_STATIC_CREATIVE", now).idempotency_key,
    ).not.toBe(job.idempotency_key);
    await run({ action: "job_retry", id: a.id });
    await run({ action: "job_cancel", id: a.id });
    snap = await controlSnapshot(rpc, true);
    expect(snap.state.jobs.find((j) => j.id === a.id)?.status).toBe(
      "cancelled",
    );
  });
  it("imports a manual external visual from verified media, preserving provenance without rights clearance", async () => {
    const p = fixture(),
      requirement = uid(),
      handoff = uid();
    p.requirements.push({
      id: requirement,
      description: "TEST manual illustration",
      required: true,
      scene_ids: [],
      usage: "Fixture",
      rights_requirements: ["Human clearance"],
      fallback_strategy: "Wait",
    });
    const result = await run({ action: "creative_save", package: p });
    const request = {
      action: "creative_handoff_request",
      id: result.id,
      handoff_id: handoff,
      provider: "chatgpt_manual",
      requirement_id: requirement,
      request: "TEST illustration handoff",
      prompt_reference: "TEST prompt reference",
    };
    await run(request);
    await run(request);
    let snap = await controlSnapshot(rpc, true);
    let record = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    expect(record.data.package.handoffs).toHaveLength(1);
    expect(record.data.package.handoffs[0].state).toBe(
      "WAITING_FOR_EXTERNAL_VISUAL",
    );
    const mediaId = await rpc("record_media", {
      p_media: {
        story_id: p.binding.story_id,
        draft_id: p.binding.draft_id,
        provider: "local",
        file_id: `TEST/${uid()}.png`,
        name: "TEST-only.png",
        mime_type: "image/png",
        bytes: 8,
        sha256: hash("TEST media bytes"),
        origin: "TEST manual external image receipt",
        created_by: actor,
      },
    });
    const command = {
      action: "creative_import",
      id: result.id,
      handoff_id: handoff,
      media_id: mediaId,
      requirement_id: requirement,
      generated_at: null,
      rights_usage_notes: "TEST rights require human clearance",
      confirmed: true,
    };
    await run(command);
    await run(command);
    snap = await controlSnapshot(rpc, true);
    record = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    const asset = record.data.package.assets[0];
    expect(record.data.package.assets).toHaveLength(1);
    expect(asset.publishable).toBe(false);
    expect(asset.rights_status).toBe("unknown");
    expect(asset.human_review).toBe("pending");
    expect(asset.import_provenance).toMatchObject({
      creator_source: "ChatGPT manual",
      brief_id: p.brief.id,
      brief_revision: 1,
      generated_at: null,
      human_selected: true,
      sha256: hash("TEST media bytes"),
      binding: p.binding,
    });
    expect(record.data.package.handoffs[0].state).toBe(
      "EXTERNAL_VISUAL_IMPORTED",
    );
    await run({
      action: "creative_asset_review",
      id: result.id,
      candidate_id: asset.id,
      decision: "accepted",
      selected: true,
      confirmed: true,
    });
    await run({ action: "creative_approve", id: result.id, confirmed: true });
    snap = await controlSnapshot(rpc, true);
    record = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    expect(
      creativeRenderIssues(record.data, snap.state, snap.stories).join(),
    ).toMatch(/rights clearance|checksum/);
    const bad = structuredClone(record.data);
    bad.package.assets[0].publishable = true as never;
    expect(creativePackageSchema.safeParse(bad.package).success).toBe(false);
    await expect(
      run({ ...command, rights_usage_notes: "Altered after import" }),
    ).rejects.toThrow("already imported");
  });
  it("exports exact Canva scenes and accepts a human selection without promoting it", async () => {
    const p = fixture(),
      requirement = uid(),
      handoff = uid();
    p.requirements.push({
      id: requirement,
      description: "TEST Canva export",
      required: true,
      scene_ids: [],
      usage: "Test",
      rights_requirements: [],
      fallback_strategy: "Wait",
    });
    const result = await run({ action: "creative_save", package: p });
    await run({
      action: "creative_handoff_request",
      id: result.id,
      handoff_id: handoff,
      provider: "canva_manual",
      requirement_id: requirement,
      request: "Manual composition test",
      prompt_reference: null,
    });
    await run({
      action: "creative_canva_editing",
      id: result.id,
      handoff_id: handoff,
    });
    let snap = await controlSnapshot(rpc, true);
    let record = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    const exported = canvaHandoff(record, snap.state, snap.stories);
    expect(exported.scene_order).toEqual(p.carousel!.scenes.map((s) => s.id));
    expect(exported.brief.exact_copy).toEqual(p.brief.exact_copy);
    expect(exported.publishable).toBe(false);
    expect(exported.visual.palette).toBeUndefined();
    const mediaId = await rpc("record_media", {
      p_media: {
        story_id: p.binding.story_id,
        draft_id: p.binding.draft_id,
        provider: "local",
        file_id: `TEST/${uid()}.png`,
        mime_type: "image/png",
        name: "Canva TEST.png",
        bytes: 8,
        sha256: hash("Canva TEST"),
        origin: "TEST Canva export",
        created_by: actor,
      },
    });
    await run({
      action: "creative_import",
      id: result.id,
      handoff_id: handoff,
      media_id: mediaId,
      requirement_id: requirement,
      generated_at: null,
      rights_usage_notes: "Not licensed by import",
      confirmed: true,
    });
    snap = await controlSnapshot(rpc, true);
    record = snap.state.entities.find(
      (e) => e.id === result.id,
    ) as Entity<CreativeRecord>;
    expect(record.data.package.handoffs[0].state).toBe("CANVA_EXPORT_IMPORTED");
    expect(record.data.package.assets[0].publishable).toBe(false);
  });
  it("rejects cross-story imports, expired epochs and missing human approval", async () => {
    const p = fixture(),
      requirement = uid(),
      handoff = uid();
    p.requirements.push({
      id: requirement,
      description: "TEST cross-story guard",
      required: true,
      scene_ids: [],
      usage: "Test",
      rights_requirements: [],
      fallback_strategy: "Wait",
    });
    const result = await run({ action: "creative_save", package: p });
    await run({
      action: "creative_handoff_request",
      id: result.id,
      handoff_id: handoff,
      provider: "chatgpt_manual",
      requirement_id: requirement,
      request: "TEST guard",
      prompt_reference: null,
    });
    const mediaId = await rpc("record_media", {
      p_media: {
        story_id: stories.find((s) => s.id !== p.binding.story_id)!.id,
        provider: "local",
        file_id: `TEST/${uid()}.png`,
        mime_type: "image/png",
        name: "wrong-story TEST.png",
        bytes: 8,
        sha256: hash("TEST"),
        origin: "TEST wrong story",
        created_by: actor,
      },
    });
    await expect(
      run({
        action: "creative_import",
        id: result.id,
        handoff_id: handoff,
        media_id: mediaId,
        requirement_id: requirement,
        generated_at: null,
        rights_usage_notes: "TEST",
        confirmed: true,
      }),
    ).rejects.toThrow("exact uploaded media revision");
    await expect(
      run({ action: "creative_approve", id: result.id, confirmed: false }),
    ).rejects.toThrow();
    await expect(
      run({ action: "creative_approve", id: result.id, confirmed: true }, 0),
    ).rejects.toThrow("Conflict");
    await expect(
      controlAction(
        rpc,
        { action: "creative_save", package: p },
        "local-worker",
        true,
      ),
    ).rejects.toThrow("Human editor");
    const wrong = structuredClone(p);
    wrong.binding.draft_revision++;
    await expect(
      run({ action: "creative_save", package: wrong }),
    ).rejects.toThrow("stale");
  });
  it("blocks stale content/drafts/specification/asset metadata downstream", () => {
    const p = fixture();
    const record: CreativeRecord = {
      status: "approved",
      package: p,
      approval: { actor, at: now, fingerprint: hash(p) },
    };
    expect(creativeRenderIssues(record, state, stories)).toEqual([]);
    p.brief.thesis = "Changed after approval";
    expect(creativeRenderIssues(record, state, stories)).toContain(
      "Exact creative specification approval required",
    );
    const stale = structuredClone(state);
    stale.entities.find((e) => e.id === content.id)!.version++;
    expect(creativeRenderIssues(record, stale, stories).join()).toContain(
      "stale",
    );
    const changed = structuredClone(stories);
    changed
      .find((s) => s.id === p.binding.story_id)!
      .drafts.find((d) => d.id === p.binding.draft_id)!.revision++;
    expect(creativeRenderIssues(record, state, changed).join()).toContain(
      "approved script revision",
    );
  });
  it("renders the same supplied approved spec through static/motion interfaces without a default aesthetic", async () => {
    const p = fixture();
    p.motion = {
      schema_version: 1,
      fps: 30,
      scenes: [
        {
          scene_id: p.carousel!.scenes[0].id,
          duration_seconds: 2,
          direction: "TEST hold",
          reduced_motion_alternative: "Static hold",
        },
      ],
      extensions: {},
    };
    const record: Entity<CreativeRecord> = {
      id: uid(),
      kind: "creative",
      version: 1,
      story_id: p.binding.story_id,
      draft_id: p.binding.draft_id,
      parent_id: p.binding.content_id,
      is_demo: true,
      data: {
        status: "approved",
        package: p,
        approval: { actor, at: now, fingerprint: hash(p) },
      },
    };
    const context = {
      state: { ...state, entities: [...state.entities, record] },
      stories,
      media: [] as CreativeMedia[],
    };
    await expect(
      renderCreative({ record, mode: "static" }, context),
    ).rejects.toThrow("NOT_CONFIGURED");
    const seen: string[] = [];
    const renderer: CreativeRenderer = {
      id: "TEST-only",
      version: "1",
      modes: ["static", "motion"],
      render: async (input) => {
        seen.push(hash(input.record.data.package));
        return {
          renderer: "TEST-only",
          renderer_version: "1",
          specification_sha256: hash(input.record.data.package),
          creative_id: record.id,
          creative_version: record.version,
          binding: p.binding,
          files: [],
          review_required: true,
          publishable: false,
        };
      },
    };
    await renderCreative({ record, mode: "static" }, context, [renderer]);
    await renderCreative({ record, mode: "motion" }, context, [renderer]);
    expect(seen[0]).toBe(seen[1]);
    await expect(
      renderCreative(
        { record: { ...record, version: 2 }, mode: "static" },
        context,
        [renderer],
      ),
    ).rejects.toThrow("stale");
  });
});
