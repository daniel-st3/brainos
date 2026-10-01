import { storageClient } from "../src/integrations/media";
const client = storageClient();
const bucket = "newsroom-artifacts";
const { data: existing } = await client.storage.getBucket(bucket);
if (existing?.public)
  throw new Error(
    "Existing bucket is public; stop and review before using it.",
  );
if (!existing) {
  const { error } = await client.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 10_000_000,
    allowedMimeTypes: [
      "image/svg+xml",
      "image/png",
      "image/jpeg",
      "application/json",
      "text/plain",
      "text/vtt",
    ],
  });
  if (error) throw error;
}
const name = `verification/${crypto.randomUUID()}.txt`;
const { error } = await client.storage
  .from(bucket)
  .upload(name, "Content OS private storage verification", {
    contentType: "text/plain",
  });
if (error) throw error;
try {
  const { data, error } = await client.storage.from(bucket).download(name);
  if (
    error ||
    (await data?.text()) !== "Content OS private storage verification"
  )
    throw new Error("Storage readback failed");
  console.log("Verified private bucket upload and download.");
} finally {
  const { error } = await client.storage.from(bucket).remove([name]);
  if (error) throw error;
}
