import { personalDriveConfiguration } from "../integrations/personal-drive";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { storageClient, driveToken } from "../integrations/media";
import type { ProductionPackage, RecordingMedia } from "./types";
import { mediaSchema, digest } from "./model";
export const productionBucket = "brainos-production";
export const maxMediaBytes = 50_000_000;
export function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "recording.mp4";
}
export async function ensureProductionStorage() {
  const c = storageClient(),
    { data, error } = await c.storage.getBucket(productionBucket);
  if (data) {
    if (data.public) throw Error("Production bucket must be private");
    return;
  }
  if (error && !/not found/i.test(error.message))
    throw Error("Cannot inspect private production storage");
  const result = await c.storage.createBucket(productionBucket, {
    public: false,
    fileSizeLimit: maxMediaBytes,
    allowedMimeTypes: [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp4",
      "text/plain",
      "text/vtt",
      "application/x-subrip",
      "application/json",
      "image/svg+xml",
    ],
  });
  if (result.error) throw result.error;
}
export async function uploadTicket(
  p: ProductionPackage,
  name: string,
  mime: string,
  bytes: number,
) {
  if (bytes <= 0 || bytes > maxMediaBytes)
    throw Error(
      "Direct upload limit is 50 MB. Use Drive or a local file for larger recordings.",
    );
  const file_id = `${p.id}/${crypto.randomUUID()}/${safeFilename(name)}`;
  const c = storageClient();
  const { data, error } = await c.storage
    .from(productionBucket)
    .createSignedUploadUrl(file_id);
  if (error) throw error;
  return {
    file_id,
    url: data.signedUrl,
    token: data.token,
    bucket: productionBucket,
    mime,
  };
}
export async function storedInfo(p: ProductionPackage, file: string) {
  if (!file.startsWith(p.id + "/") || file.includes(".."))
    throw Error("Storage object belongs to another production");
  const { data, error } = await storageClient()
    .storage.from(productionBucket)
    .info(file);
  if (error || !data) throw Error("Uploaded object not found");
  return {
    bytes: Number(data.size ?? data.metadata?.size),
    mime: String(data.contentType ?? data.metadata?.mimetype),
  };
}
export async function driveInfo(fileId: string) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    throw Error("Use a stable Google Drive file ID");
  const token = await driveToken();
  const get = async (id: string) => {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size,createdTime,parents,videoMediaMetadata,trashed`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) throw Error("Drive file unavailable");
    return (await r.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size: string;
      createdTime: string;
      parents?: string[];
      trashed?: boolean;
      videoMediaMetadata?: { durationMillis: string };
    };
  };
  const file = await get(fileId);
  if (file.trashed) throw Error("Drive file is trashed");
  const { root } = personalDriveConfiguration();
  let parents = file.parents ?? [],
    inside = false;
  for (let depth = 0; depth < 12 && parents.length; depth++) {
    if (parents.includes(root)) {
      inside = true;
      break;
    }
    parents = (await get(parents[0])).parents ?? [];
  }
  if (!inside)
    throw Error(
      "Recording must be inside the configured Daniel-owned Drive root",
    );
  return { file, token };
}
export async function registerMedia(p: ProductionPackage, raw: unknown) {
  const m = mediaSchema.parse(raw);
  if (m.provider === "supabase") {
    const info = await storedInfo(p, m.file_id);
    m.bytes = info.bytes;
    m.mime = mediaSchema.shape.mime.parse(info.mime);
  }
  if (m.provider === "drive") {
    const { file } = await driveInfo(m.file_id);
    m.filename = file.name;
    m.mime = mediaSchema.shape.mime.parse(file.mimeType);
    m.bytes = Number(file.size);
    m.captured_at = file.createdTime;
    m.duration = file.videoMediaMetadata
      ? Number(file.videoMediaMetadata.durationMillis) / 1000
      : null;
  }
  return mediaSchema.parse(m);
}
export async function mediaSource(m: RecordingMedia) {
  if (m.provider === "local") return { provider: "local", file: m.file_id };
  if (m.provider === "drive") {
    const { token } = await driveInfo(m.file_id);
    return {
      provider: "drive",
      url: `https://www.googleapis.com/drive/v3/files/${m.file_id}?alt=media`,
      headers: { Authorization: `Bearer ${token}` },
    };
  }
  const { data, error } = await storageClient()
    .storage.from(productionBucket)
    .createSignedUrl(m.file_id, 3600);
  if (error) throw error;
  return { provider: "supabase", url: data.signedUrl };
}
export async function storeGraphic(
  p: ProductionPackage,
  svg: string,
  name: string,
) {
  const file = `${p.id}/graphics/${digest(svg)}-${safeFilename(name)}.svg`;
  if (process.env.CONTENT_OS_MODE !== "supabase") {
    const root = path.resolve(
      process.env.CONTENT_OS_DATA_DIR ?? ".data/newsroom",
      "production",
    );
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, svg);
    return file;
  }
  const { error } = await storageClient()
    .storage.from(productionBucket)
    .upload(file, new TextEncoder().encode(svg), {
      contentType: "image/svg+xml",
      upsert: false,
    });
  if (error && !/already exists/.test(error.message)) throw error;
  return file;
}
export async function graphicBytes(p: ProductionPackage, file: string) {
  if (!file.startsWith(p.id + "/graphics/") || file.includes(".."))
    throw Error("Invalid graphic reference");
  if (process.env.CONTENT_OS_MODE !== "supabase")
    return new Uint8Array(
      await readFile(
        path.resolve(
          process.env.CONTENT_OS_DATA_DIR ?? ".data/newsroom",
          "production",
          file,
        ),
      ),
    );
  const { data, error } = await storageClient()
    .storage.from(productionBucket)
    .download(file);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
