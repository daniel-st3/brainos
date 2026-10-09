import { expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
const memory = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../src/integrations/media", () => ({
  storageClient: () => ({
    storage: {
      from: () => ({
        download: async (id: string) => ({
          data: memory.has(id)
            ? new Blob([new Uint8Array(memory.get(id)!)])
            : null,
          error: null,
        }),
        upload: async (id: string, b: Buffer) => {
          memory.set(id, b);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("../src/approval/notifications", () => ({
  deliverReviewNotifications: async () => ({ sent: 1, status: "SENT" }),
}));
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc } from "../src/ingestion/store";
import { readControl } from "../src/control/service";
import { queueNewsroomRun } from "../src/newsroom/queue";
import { completeNewsroom } from "../src/newsroom/complete";
import type { CreatorSnapshot } from "../src/creator/discovery";
import type { Job } from "../src/control/model";
const hash = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
it.each([false, true])(
  "persists exact staging media (mixed=%s) before notification without clearing rights or creating an outbox",
  async (mixed) => {
    const db = await initializeDb();
    try {
      await seedDb(db);
      const rpc = localRpc(db),
        s = await readControl(rpc, true);
      await rpc("commit_control", {
        p_epoch: s.epoch,
        p_entities: [
          {
            id: randomUUID(),
            kind: "account",
            version: 1,
            is_demo: true,
            parent_id: null,
            story_id: null,
            draft_id: null,
            data: {
              platform: "instagram",
              handle: "staging",
              external_id: "simulation-only",
              status: "connected",
              simulation: "success",
              capabilities: [],
            },
          },
        ],
        p_jobs: [],
        p_public: [],
        p_actor: "test",
      });
      const snapshot = {
        captured_at: new Date().toISOString(),
        briefs: [{ eligible_for_research: true }],
      } as CreatorSnapshot;
      await queueNewsroomRun(rpc, snapshot);
      const job = (await rpc("claim_newsroom_job")) as Job;
      const media = [1, 2, 3].map((i) => {
        const isVideo = mixed && i === 2;
        const name = `0${i}.${isVideo ? "mp4" : "png"}`,
          b = Buffer.from("fixture " + i),
          sha = hash(b),
          file_id = `${job.input.package_id}/external/${sha}/${name}`;
        memory.set(file_id, b);
        return {
          name,
          sha256: sha,
          bytes: b.length,
          file_id,
          width: 1080,
          height: 1350,
          ...(isVideo
            ? {
                mime: "video/mp4",
                duration: 6,
                source_id: hash("source"),
              }
            : {}),
        };
      });
      const excerpt =
        "Primary source evidence explaining this product announcement and its limitations. This is a vendor claim, not independently demonstrated performance.";
      const raw = {
        title: "Real source staging fixture",
        caption:
          "Google presenta una herramienta para coordinar tareas entre distintas aplicaciones de trabajo. Según la empresa, puede mantener el contexto del proyecto y trabajar con la información compartida. Son capacidades anunciadas por el proveedor; todavía hace falta comprobar cómo funcionan en situaciones reales y con permisos limitados.",
        source_url: "https://example.com/primary",
        source_sha256: hash(excerpt),
        source_excerpt: excerpt,
        source_retrieved_at: new Date().toISOString(),
        claims: [
          { text: "Announcement", evidence_quote: "Primary source evidence" },
          {
            text: "Limitation",
            evidence_quote: "not independently demonstrated performance",
          },
        ],
        angle: "Assess announcement",
        visual_thesis: "Story specific",
        assets: [
          {
            url: "https://example.com/image.png",
            sha256: hash("source"),
            rights: "UNCLEAR",
            width: 1080,
            height: 1350,
          },
        ],
        media,
        qa: { pass: true, findings: [], limitations: [] },
        metrics: { calls: [] },
      };
      const r = await completeNewsroom(rpc, job, raw);
      expect(r.state).toBe("AWAITING_DANIEL");
      expect(r.publication_eligible).toBe(false);
      const after = await readControl(rpc, true),
        review = after.entities.find((e) => e.id === r.candidate_id)!;
      const frozen = review.data.frozen as {
        imported: { media: { name: string; mime: string; sha256: string }[] };
      };
      expect(frozen.imported.media.map((m) => m.name)).toEqual(
        media.map((m) => m.name),
      );
      expect(frozen.imported.media.map((m) => m.sha256)).toEqual(
        media.map((m) => m.sha256),
      );
      expect(frozen.imported.media[1].mime).toBe(
        mixed ? "video/mp4" : "image/png",
      );
      expect(review.data.decision).toBe(null);
      expect(review.data.outbox_id).toBe(null);
      expect(JSON.stringify(review.data)).toContain("UNCLEAR");
      expect(after.jobs.find((j) => j.id === job.id)?.status).toBe("succeeded");
      expect(
        (await rpc("read_provider_outbox", { p_demo: true })) as unknown[],
      ).toHaveLength(0);
    } finally {
      await db.close();
    }
  },
);
