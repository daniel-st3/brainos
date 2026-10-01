import { createClient } from "@supabase/supabase-js";
import {
  ensureProductionStorage,
  uploadTicket,
  storedInfo,
  productionBucket,
} from "../src/production/storage";
import { storageClient } from "../src/integrations/media";
import type { ProductionPackage } from "../src/production/types";
await ensureProductionStorage();
const server = storageClient();
const { error } = await server.rpc("read_production");
if (error) throw error;
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false } },
);
for (const name of ["read_production", "claim_production"]) {
  const { error } = await anon.rpc(name);
  if (!error) throw Error(`Anonymous access to ${name} was not blocked`);
}
const p = { id: crypto.randomUUID() } as ProductionPackage;
const content = "BrainOS private production storage verification";
const ticket = await uploadTicket(
  p,
  "verification.txt",
  "text/plain",
  Buffer.byteLength(content),
);
try {
  const upload = await fetch(ticket.url, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
  if (!upload.ok) throw Error(`Signed upload failed: ${upload.status}`);
  const info = await storedInfo(p, ticket.file_id);
  if (
    info.bytes !== Buffer.byteLength(content) ||
    !info.mime.startsWith("text/plain")
  )
    throw Error("Object metadata mismatch");
  const { data, error } = await server.storage
    .from(productionBucket)
    .download(ticket.file_id);
  if (error || (await data?.text()) !== content)
    throw Error("Private download mismatch");
  const { error: denied } = await anon.storage
    .from(productionBucket)
    .download(ticket.file_id);
  if (!denied) throw Error("Anonymous private object download succeeded");
  console.log(
    "Production RPCs protected; private storage signed upload, metadata, download, and anonymous denial verified.",
  );
} finally {
  const { error } = await server.storage
    .from(productionBucket)
    .remove([ticket.file_id]);
  if (error) throw error;
}
