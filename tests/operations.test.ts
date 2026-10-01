import { afterAll, beforeAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { createDemoStories } from "../src/domain/seed";
import { applyCommand } from "../src/domain/workflow";
import {
  researchPacket,
  evidenceFingerprint,
} from "../src/operations/research";
import { enqueueEditorialWork, runOperations } from "../src/operations/worker";
import {
  approvedProductionPacket,
  sourceCard,
} from "../src/operations/production";
import { publishingHandoff } from "../src/integrations/publishing";
import {
  snapshotDue,
  analyticsProviderFor,
} from "../src/integrations/analytics";
import { liveEditorial } from "../src/services/live-editorial";
import type { Story } from "../src/domain/types";
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
});
afterAll(async () => db.close());
describe("operational automation", () => {
  it("deduplicates jobs, claims exclusively and rejects stale worker completion", async () => {
    const args = {
      p_kind: "enrich",
      p_key: "lease-test",
      p_story: createDemoStories()[0].id,
    };
    const id = await rpc("enqueue_operation", args);
    expect(await rpc("enqueue_operation", args)).toBe(id);
    const job = (await rpc("claim_operation")) as {
      id: string;
      lease_token: string;
    };
    expect(job.id).toBe(id);
    expect(await rpc("claim_operation")).toBeNull();
    await expect(
      rpc("finish_operation", {
        p_id: id,
        p_token: crypto.randomUUID(),
        p_status: "succeeded",
      }),
    ).rejects.toThrow("lease lost");
    await rpc("finish_operation", {
      p_id: id,
      p_token: job.lease_token,
      p_status: "failed",
      p_error: "transient",
    });
    const rows = await db.query<{ status: string; attempts: number }>(
      "select status,attempts from operation_jobs where id=$1",
      [id],
    );
    expect(rows.rows[0]).toEqual({ status: "queued", attempts: 1 });
  });
  it("stores evidence-linked enrichment without editing workflow, confidence, or pilot data", async () => {
    const story = createDemoStories()[0];
    const before = JSON.stringify(story);
    const id = await rpc("enqueue_operation", {
      p_kind: "enrich",
      p_key: "enrichment-test",
      p_story: story.id,
      p_payload: { fingerprint: evidenceFingerprint(story) },
    });
    expect(await runOperations(rpc)).toContainEqual({
      id,
      status: "succeeded",
    });
    const records = await db.query<{
      output: ReturnType<typeof researchPacket>;
    }>("select output from generation_records where job_id=$1", [id]);
    expect(records.rows[0].output.candidate_claims[0].verification_status).toBe(
      "unverified",
    );
    expect(JSON.stringify(story)).toBe(before);
    const saved = ((await rpc("read_newsroom")) as Story[]).find(
      (s) => s.id === story.id,
    )!;
    expect(saved.status).toBe(story.status);
    expect(saved.version).toBe(story.version);
    await expect(
      db.exec("update generation_records set human_verified=true"),
    ).rejects.toThrow("append-only");
  });
  it("cannot create opinion memory from an unapproved AI suggestion or without explicit confirmation", async () => {
    const story = createDemoStories()[0],
      angle = story.angles[0];
    await expect(
      rpc("confirm_opinion", {
        p_story: story.id,
        p_angle: angle.id,
        p_topic: "Test",
        p_context: "context",
        p_actor: "Daniel",
        p_confirmed: false,
      }),
    ).rejects.toThrow("Explicit human");
    await expect(
      rpc("confirm_opinion", {
        p_story: story.id,
        p_angle: angle.id,
        p_topic: "Test",
        p_context: "context",
        p_actor: "automation",
        p_confirmed: true,
      }),
    ).rejects.toThrow("explicitly approved");
  });
  it("preserves explicit opinion provenance and supersedes by adding history", async () => {
    const original = createDemoStories()[1];
    const actor = "Daniel";
    const angle = original.angles[0];
    const story = await applyCommand(
      original,
      { type: "approve_angle", angleId: angle.id },
      actor,
    );
    await rpc("save_story", {
      p_story: story,
      p_expected_version: original.version,
    });
    const args = {
      p_story: story.id,
      p_angle: angle.id,
      p_topic: "Operational testing",
      p_context: "Explicit API confirmation",
      p_actor: actor,
      p_confirmed: true,
    };
    const first = await rpc("confirm_opinion", args);
    const second = await rpc("confirm_opinion", {
      ...args,
      p_supersedes: first,
    });
    const state = (await rpc("read_operations")) as {
      opinions: { id: string; current: boolean }[];
    };
    expect(state.opinions.find((o) => o.id === first)?.current).toBe(false);
    expect(state.opinions.find((o) => o.id === second)?.current).toBe(true);
    await expect(db.exec("delete from opinion_memory")).rejects.toThrow(
      "append-only",
    );
  });
  it("blocks production and publishing handoff without exact revision approval and rights", () => {
    const story = createDemoStories().find((s) => s.status === "approved")!;
    expect(story).toBeDefined();
    const draft = story.drafts.find((d) => d.id === story.active_draft_id)!;
    expect(approvedProductionPacket(story, draft.id).revision).toBe(
      draft.revision,
    );
    const changed = structuredClone(story);
    changed.drafts.find((d) => d.id === draft.id)!.status = "superseded";
    expect(() => approvedProductionPacket(changed, draft.id)).toThrow(
      "approved",
    );
    if (story.assets[0]) {
      const blocked = structuredClone(story);
      blocked.assets[0].publishable = false;
      blocked.drafts
        .find((d) => d.id === draft.id)!
        .asset_ids.push(blocked.assets[0].id);
      expect(() => approvedProductionPacket(blocked, draft.id)).toThrow(
        "clearance",
      );
    }
    expect(() => publishingHandoff(story, story.publications[0].id)).toThrow(
      "scheduled",
    );
  });
  it("adapts real-source working drafts across platforms without demo claims or auto-approval", async () => {
    const story = createDemoStories()[1];
    story.is_demo = false;
    const angle = story.angles[0];
    const results = await Promise.all(
      (["short_video", "instagram", "x", "newsletter"] as const).map((p) =>
        liveEditorial.generateDraft(story, angle, p),
      ),
    );
    expect(new Set(results.map((d) => d.body)).size).toBe(4);
    expect(results[0].shot_notes).toBeTruthy();
    expect(results[1].body).toContain("Slide 5");
    expect(
      [results[2].hook, results[2].body, results[2].cta].join("\n").length,
    ).toBeLessThanOrEqual(280);
    expect(results.every((d) => !d.body.includes("[DEMO"))).toBe(true);
  });
  it("escapes untrusted card text and schedules raw snapshots at exact elapsed offsets", () => {
    const story = createDemoStories()[0];
    story.title = "<script>alert(1)</script>";
    const svg = sourceCard(story);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(snapshotDue("2026-09-30T23:00:00Z", 24)).toBe(
      "2026-10-01T23:00:00.000Z",
    );
    expect(snapshotDue("2026-09-30T23:00:00Z", 168)).toBe(
      "2026-10-07T23:00:00.000Z",
    );
  });
  it("requires confirmed published content for analytics and denies browser access to all operations", async () => {
    const story = createDemoStories()[4];
    await expect(
      rpc("record_analytics", {
        p_publication: story.publications[0].id,
        p_provider: "x",
        p_window: 24,
        p_post_id: "123",
        p_metrics: { views: 7 },
      }),
    ).rejects.toThrow("Confirmed publication");
    const result = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('authenticated','operation_jobs','SELECT') or has_function_privilege('anon','confirm_opinion(uuid,uuid,text,text,text,boolean,uuid)','EXECUTE') as allowed",
    );
    expect(result.rows[0].allowed).toBe(false);
  });
  it("never auto-enqueues draft jobs for unconfirmed detected stories", async () => {
    const story = createDemoStories()[0];
    story.is_demo = false;
    story.status = "detected";
    story.research_confirmed = false;
    await enqueueEditorialWork(rpc, [story]);
    const result = await db.query<{ count: number }>(
      "select count(*)::int as count from operation_jobs where kind='draft'",
    );
    expect(result.rows[0].count).toBe(0);
  });
  it("automatically drafts four formats only after human research and angle approval, then stays idempotent", async () => {
    let story = ((await rpc("read_newsroom")) as Story[]).find(
      (s) => s.id === createDemoStories()[5].id,
    )!;
    const approved = await applyCommand(
      story,
      { type: "approve_angle", angleId: story.angles[0].id },
      "Daniel",
    );
    await rpc("save_story", {
      p_story: approved,
      p_expected_version: story.version,
    });
    story = await applyCommand(
      approved,
      { type: "transition", target: "angle_ready" },
      "Daniel",
    );
    await rpc("save_story", {
      p_story: story,
      p_expected_version: approved.version,
    });
    const id = await rpc("enqueue_operation", {
      p_kind: "draft",
      p_key: "four-platforms",
      p_story: story.id,
      p_payload: { angleId: story.angles[0].id },
    });
    const result = await runOperations(rpc);
    expect(result).toContainEqual({ id, status: "succeeded" });
    const after = ((await rpc("read_newsroom")) as Story[]).find(
      (s) => s.id === story.id,
    )!;
    expect(after.drafts).toHaveLength(4);
    expect(
      after.drafts.every((d) => d.status === "draft" && !d.approved_at),
    ).toBe(true);
    expect(after.status).toBe("drafted");
    expect(after.publications).toHaveLength(0);
    expect(
      await rpc("enqueue_operation", {
        p_kind: "draft",
        p_key: "four-platforms",
        p_story: story.id,
        p_payload: { angleId: story.angles[0].id },
      }),
    ).toBe(id);
    await runOperations(rpc);
    const repeat = ((await rpc("read_newsroom")) as Story[]).find(
      (s) => s.id === story.id,
    )!;
    expect(repeat.drafts).toHaveLength(4);
  });
  it("marks an unconfigured post-recording integration blocked instead of inventing a result", async () => {
    const id = await rpc("enqueue_operation", {
      p_kind: "post_recording",
      p_key: "no-media-worker",
      p_story: createDemoStories()[0].id,
    });
    expect(await runOperations(rpc)).toContainEqual({ id, status: "blocked" });
    const row = await db.query<{ status: string; result: unknown }>(
      "select status,result from operation_jobs where id=$1",
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "blocked", result: null });
  });
  it("routes analytics by real publication host instead of assuming every short video is YouTube", () => {
    expect(
      analyticsProviderFor(
        "short_video",
        "https://www.tiktok.com/@creator/video/123",
      ),
    ).toBe("tiktok");
    expect(analyticsProviderFor("short_video", "https://youtu.be/abc")).toBe(
      "youtube",
    );
    expect(
      analyticsProviderFor(
        "short_video",
        "https://youtube.com.unrelated.example/video",
      ),
    ).toBeNull();
  });
});
