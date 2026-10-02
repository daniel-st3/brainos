import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { Rpc } from "../ingestion/store";
import { readControl } from "../control/service";
export async function rasterize(svg: string) {
  if (
    svg.length > 500000 ||
    /<(?:image|script|foreignObject)\b|(?:href|url)\s*[=(]/i.test(svg)
  )
    throw Error("Unsafe raster source");
  const png = await sharp(Buffer.from(svg), { limitInputPixels: 8_000_000 })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: png.data,
    sha256: createHash("sha256").update(png.data).digest("hex"),
    width: png.info.width,
    height: png.info.height,
  };
}
export async function rasterOutputs(
  id: string,
  outputs: { svg: string; sha256: string; [key: string]: unknown }[],
  demo: boolean,
) {
  const result = [];
  for (const o of outputs) {
    const r = await rasterize(o.svg),
      file = `graphics/${id}/${o.sha256}.png`;
    const jpeg = await sharp(r.bytes)
      .flatten({ background: "#f4f1e9" })
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const jpegFile = `graphics/${id}/${o.sha256}.jpg`;
    if (process.env.CONTENT_OS_MODE === "supabase") {
      const { storageClient } = await import("../integrations/media");
      const { error } = await storageClient()
        .storage.from("brainos-production")
        .upload(file, r.bytes, { contentType: "image/png", upsert: true });
      if (error) throw Error("Private raster upload failed");
      const saved = await storageClient()
        .storage.from("brainos-production")
        .upload(jpegFile, jpeg, { contentType: "image/jpeg", upsert: true });
      if (saved.error) throw Error("Private JPEG upload failed");
    } else {
      const dir = path.join(
        /* turbopackIgnore: true */ process.cwd(),
        ".data",
        demo ? "demo-raster" : "live-raster",
        id,
      );
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, o.sha256 + ".png"), r.bytes, {
        mode: 0o600,
      });
      await writeFile(path.join(dir, o.sha256 + ".jpg"), jpeg, { mode: 0o600 });
    }
    result.push({
      ...o,
      jpeg: {
        file_id: jpegFile,
        sha256: createHash("sha256").update(jpeg).digest("hex"),
        source_svg_sha256: o.sha256,
        width: r.width,
        height: r.height,
        bytes: jpeg.length,
        mime: "image/jpeg",
      },
      png: {
        file_id: file,
        sha256: r.sha256,
        source_svg_sha256: o.sha256,
        width: r.width,
        height: r.height,
        bytes: r.bytes.length,
        mime: "image/png",
      },
    });
  }
  return result;
}
export async function graphicRasterUrls(
  rpc: Rpc,
  refs: { id: string; version: number }[],
  demo: boolean,
  format: "png" | "jpeg" = "png",
) {
  const state = await readControl(rpc, demo),
    urls: string[] = [];
  const { storageClient } = await import("../integrations/media");
  for (const ref of refs) {
    const g = state.entities.find(
      (e) => e.id === ref.id && e.kind === "graphic",
    );
    if (
      !g ||
      g.version !== ref.version ||
      g.data.rights !== "cleared" ||
      !g.data.publishable
    )
      throw Error("Current cleared graphic required");
    for (const o of g.data.outputs as {
      sha256: string;
      png?: { file_id: string; source_svg_sha256: string };
      jpeg?: { file_id: string; source_svg_sha256: string };
    }[]) {
      const file = o[format];
      if (!file || file.source_svg_sha256 !== o.sha256)
        throw Error("Raster is missing or stale");
      const { data, error } = await storageClient()
        .storage.from("brainos-production")
        .createSignedUrl(file.file_id, 7200);
      if (error || !data) throw Error("Raster unavailable");
      urls.push(data.signedUrl);
    }
  }
  return urls;
}
export async function rasterBytes(
  id: string,
  sourceSha: string,
  demo: boolean,
) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha) || !/^[a-f0-9-]{36}$/.test(id))
    throw Error("Invalid asset reference");
  if (process.env.CONTENT_OS_MODE !== "supabase")
    return readFile(
      path.join(
        /* turbopackIgnore: true */ process.cwd(),
        ".data",
        demo ? "demo-raster" : "live-raster",
        id,
        sourceSha + ".png",
      ),
    );
  const { storageClient } = await import("../integrations/media"),
    r = await storageClient()
      .storage.from("brainos-production")
      .download(`graphics/${id}/${sourceSha}.png`);
  if (r.error || !r.data) throw Error("Raster unavailable");
  return Buffer.from(await r.data.arrayBuffer());
}
