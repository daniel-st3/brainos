import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Rpc } from "../ingestion/store";
export interface DeliveryAsset {
  file_id: string;
  mime: string;
  bytes: number;
  sha256: string;
  graphic_id?: string;
  graphic_version?: number;
}
/** Generated only while dispatching an exact final-approved outbox request. */
export async function deliveryUrl(
  rpc: Rpc,
  outboxId: string,
  key: string,
  asset: DeliveryAsset,
) {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!origin || new URL(origin).protocol !== "https:")
    throw Error("Media delivery runtime missing");
  const id = randomUUID(),
    secret = randomBytes(32).toString("base64url");
  await rpc("register_media_delivery", {
    p_record: {
      id,
      outbox_id: outboxId,
      secret_hash: createHash("sha256").update(secret).digest("hex"),
      asset_key: key,
      bucket: "brainos-production",
      ...asset,
    },
  });
  const extension =
    asset.mime === "video/mp4"
      ? "mp4"
      : asset.mime === "image/jpeg"
        ? "jpg"
        : "png";
  return `${origin}/functions/v1/brainos-media/${id}/${secret}/asset.${extension}`;
}
