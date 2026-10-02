import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { initializeDb } from "../src/server/local-db";
import { localRpc } from "../src/ingestion/store";
import { rasterOutputs } from "../src/providers/raster";
import {
  orderedCarousel,
  exportCarouselDrive,
} from "../src/providers/carousel";
vi.mock("../src/integrations/media", () => ({
  driveToken: async () => "fixture-token-NOT-REAL",
}));
vi.mock("../src/integrations/personal-drive", () => ({
  personalDriveConfiguration: () => ({
    root: "fixture-personal-folder",
    email: "fixture@gmail.com",
  }),
}));
it("ordered PNG Drive export is leased, content-addressed and reuses the durable receipt", async () => {
  const db = await initializeDb(),
    rpc = localRpc(db),
    id = crypto.randomUUID();
  try {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#f4f1e9"/><text x="72" y="200">DEMO / FICTIONAL FIXTURE</text></svg>';
    const outputs = await rasterOutputs(
      id,
      [
        {
          svg,
          sha256: createHash("sha256").update(svg).digest("hex"),
          slide: 0,
        },
      ],
      false,
    );
    await rpc("commit_control", {
      p_epoch: 0,
      p_entities: [
        {
          id,
          kind: "graphic",
          version: 1,
          story_id: null,
          draft_id: null,
          parent_id: null,
          is_demo: false,
          data: {
            rights: "cleared",
            publishable: true,
            outputs,
            template_version: 1,
          },
        },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "fixture-only",
    });
    const requests = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "fixture-file-ID" })),
      );
    vi.stubGlobal("fetch", requests);
    const first = await exportCarouselDrive(rpc, id, false),
      second = await exportCarouselDrive(rpc, id, false);
    expect(first.files).toEqual(second.files);
    expect(requests).toHaveBeenCalledTimes(3);
    expect((await orderedCarousel(rpc, id, false)).slides[0].order).toBe(1);
    await db.query(
      "update control_entities set data=jsonb_set(data,'{rights}','\"unknown\"') where id=$1",
      [id],
    );
    await expect(orderedCarousel(rpc, id, false)).rejects.toThrow("clearance");
  } finally {
    vi.unstubAllGlobals();
    await db.close();
  }
}, 30000);
