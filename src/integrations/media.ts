import {
  personalDriveConfiguration,
  verifyPersonalDrive,
} from "./personal-drive";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Rpc } from "../ingestion/store";
const bucket = "newsroom-artifacts";
export function storageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("Supabase runtime storage authorization is required.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function storeArtifact(
  rpc: Rpc,
  input: {
    storyId: string;
    draftId?: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
    actor: string;
    origin: string;
  },
) {
  if (input.bytes.length > 10_000_000)
    throw new Error("Use Drive for media over 10 MB.");
  if (
    ![
      "image/svg+xml",
      "image/png",
      "image/jpeg",
      "application/json",
      "text/plain",
      "text/vtt",
    ].includes(input.mime)
  )
    throw new Error("Unsupported artifact MIME type.");
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  const name = input.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${input.storyId}/${digest}/${name}`;
  const client = storageClient();
  const { error } = await client.storage
    .from(bucket)
    .upload(path, input.bytes, { contentType: input.mime, upsert: false });
  if (
    error &&
    error.message !== "The resource already exists" &&
    !("statusCode" in error && String(error.statusCode) === "409")
  )
    throw new Error("Private storage upload failed.");
  const id = await rpc("record_media", {
    p_media: {
      story_id: input.storyId,
      draft_id: input.draftId ?? null,
      provider: "supabase",
      file_id: path,
      folder_id: bucket,
      mime_type: input.mime,
      name,
      bytes: input.bytes.length,
      sha256: digest,
      origin: input.origin,
      created_by: input.actor,
    },
  });
  // An uploaded object is not editorial clearance. No asset publishable flag changes here.
  return { id, provider: "supabase", bucket, fileId: path, publishable: false };
}
export async function driveToken() {
  personalDriveConfiguration();
  const clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    configuredRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  let refreshToken = configuredRefreshToken;
  if (!refreshToken && process.env.CONTENT_OS_MODE === "supabase") {
    const { applicationRpc } = await import("../ingestion/store");
    const { openSecret } = await import("./google-oauth");
    const connection = (await (
      await applicationRpc()
    )("read_google_connection")) as { encrypted_refresh_token: string } | null;
    if (connection)
      refreshToken = openSecret(connection.encrypted_refresh_token, "refresh");
  }
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error(
      "Google runtime OAuth authorization required; Codex connector access is separate.",
    );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Google token refresh failed (${response.status}).`);
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) throw new Error("Google access token missing.");
  await verifyPersonalDrive(result.access_token);
  return result.access_token;
}
export async function uploadOwnedMedia(
  rpc: Rpc,
  input: {
    storyId: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
    actor: string;
    ownedConfirmed: true;
  },
) {
  if (input.ownedConfirmed !== true)
    throw new Error("Explicit owned-media confirmation required.");
  const { root } = personalDriveConfiguration();
  if (input.bytes.length > 10_000_000)
    throw new Error(
      "Use Drive directly for large raw recordings; register their file IDs.",
    );
  const access = await driveToken();
  const initialized = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": input.mime,
      },
      body: JSON.stringify({ name: input.name, parents: [root] }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const location = initialized.headers.get("location");
  if (!initialized.ok || !location)
    throw new Error(
      `Drive upload initialization failed (${initialized.status}).`,
    );
  const destination = new URL(location);
  if (
    destination.protocol !== "https:" ||
    destination.hostname !== "www.googleapis.com"
  )
    throw new Error("Unexpected Drive upload destination.");
  const response = await fetch(destination, {
    method: "PUT",
    headers: { "Content-Type": input.mime },
    body: new Uint8Array(input.bytes),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Drive upload failed (${response.status}).`);
  const file = (await response.json()) as { id: string };
  const id = await rpc("record_media", {
    p_media: {
      story_id: input.storyId,
      provider: "drive",
      file_id: file.id,
      folder_id: root,
      mime_type: input.mime,
      name: input.name,
      bytes: input.bytes.length,
      origin:
        "Daniel-confirmed owned media; clearance remains a separate editorial decision",
      created_by: input.actor,
    },
  });
  return { id, fileId: file.id, publishable: false };
}
