import type { Rpc } from "../ingestion/store";
import { readControl } from "../control/service";
import { rasterBytes } from "./raster";
import { createHash } from "node:crypto";
import { driveToken } from "../integrations/media";
import { personalDriveConfiguration } from "../integrations/personal-drive";
export async function orderedCarousel(rpc: Rpc, id: string, demo: boolean) {
  const s = await readControl(rpc, demo),
    g = s.entities.find((e) => e.id === id && e.kind === "graphic");
  if (!g || g.data.rights !== "cleared" || !g.data.publishable)
    throw Error("Exact graphic rights clearance required");
  const outputs = g.data.outputs as {
    slide: number;
    sha256: string;
    png?: {
      sha256: string;
      source_svg_sha256: string;
      width: number;
      height: number;
    };
  }[];
  if (!outputs?.length) throw Error("Render PNGs first");
  const slides = [];
  for (const [n, o] of outputs.entries()) {
    if (!o.png || o.png.source_svg_sha256 !== o.sha256 || o.slide !== n)
      throw Error("Ordered current raster required");
    const bytes = await rasterBytes(id, o.sha256, demo);
    if (createHash("sha256").update(bytes).digest("hex") !== o.png.sha256)
      throw Error("Raster checksum mismatch");
    slides.push({
      order: n + 1,
      name: `brainos-${id.slice(0, 8)}-v${g.version}-${String(n + 1).padStart(2, "0")}.png`,
      ...o.png,
      bytes,
    });
  }
  return { graphic: g, slides };
}
/** Content-addressed exports reuse existing files in the configured personal root. No folders created. */
export async function exportCarouselDrive(rpc: Rpc, id: string, demo: boolean) {
  if (demo) throw Error("Demo mode cannot write to personal Drive");
  const { graphic, slides } = await orderedCarousel(rpc, id, demo);
  const job = (await rpc("claim_graphic_export", {
    p_id: id,
    p_version: graphic.version,
    p_demo: demo,
  })) as {
    id: string;
    lease_token: string;
    status: string;
    result?: { files: unknown[] };
  };
  if (job.status === "succeeded")
    return { files: job.result?.files ?? [], reused: true };
  try {
    const access = await driveToken(),
      { root } = personalDriveConfiguration(),
      files = [];
    for (const slide of slides) {
      const key = `${id}:${graphic.version}:${slide.order}:${slide.sha256}`;
      const q = `'${root}' in parents and trashed=false and appProperties has { key='brainosExport' and value='${key}' }`;
      const list = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`,
        {
          headers: { Authorization: `Bearer ${access}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!list.ok) throw Error("Drive export lookup failed");
      const existing = (await list.json()).files as { id: string }[];
      if (existing.length) {
        files.push({ order: slide.order, id: existing[0].id, reused: true });
        continue;
      }
      const init = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": "image/png",
          },
          body: JSON.stringify({
            name: slide.name,
            parents: [root],
            appProperties: { brainosExport: key },
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      const location = init.headers.get("location");
      if (
        !init.ok ||
        !location ||
        new URL(location).origin !== "https://www.googleapis.com"
      )
        throw Error("Drive export initialization failed");
      const put = await fetch(location, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: Uint8Array.from(slide.bytes),
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!put.ok)
        throw Error(
          "Drive export upload failed; inspect personal folder before retry",
        );
      files.push({
        order: slide.order,
        id: (await put.json()).id,
        reused: false,
      });
    }
    const state = await readControl(rpc, false);
    await rpc("commit_control", {
      p_epoch: state.epoch,
      p_entities: [
        {
          id: crypto.randomUUID(),
          kind: "review",
          version: 1,
          story_id: graphic.story_id,
          draft_id: graphic.draft_id,
          parent_id: graphic.id,
          is_demo: false,
          data: {
            type: "carousel_drive_export",
            graphic_id: id,
            graphic_revision: graphic.version,
            files,
            at: new Date().toISOString(),
          },
        },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "carousel-export",
    });
    await rpc("finish_control_job", {
      p_id: job.id,
      p_token: job.lease_token,
      p_status: "succeeded",
      p_result: { files },
      p_error: null,
      p_retryable: false,
    });
    return { files };
  } catch (e) {
    await rpc("finish_control_job", {
      p_id: job.id,
      p_token: job.lease_token,
      p_status: "failed",
      p_result: {},
      p_error: "DRIVE_EXPORT_FAILED",
      p_retryable: true,
    }).catch(() => {});
    throw e;
  }
}
