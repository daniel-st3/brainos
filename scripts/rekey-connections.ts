/** Run with the private new/current key plus previous key. Dry-run is the default. */
import { applicationRpc } from "../src/ingestion/store";
import { readControl } from "../src/control/service";
import { openSecret, sealSecret } from "../src/integrations/google-oauth";
if (
  !process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS ||
  process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS ===
    process.env.INTEGRATION_ENCRYPTION_KEY
)
  throw Error(
    "Distinct current/new and previous keys required; no keys logged",
  );
const rpc = await applicationRpc(),
  state = await readControl(rpc, false),
  writes: { id: string; ciphertext: string }[] = [];
for (const a of state.entities.filter((e) => e.kind === "account")) {
  const encrypted = (await rpc("provider_secret", { p_id: a.id })) as
    string | null;
  if (encrypted)
    writes.push({
      id: a.id,
      ciphertext: sealSecret(
        openSecret(encrypted, `provider:${a.id}`),
        `provider:${a.id}`,
      ),
    });
}
const google = (await rpc("read_google_connection")) as {
  encrypted_refresh_token: string;
  scopes: string[];
  authorized_by: string;
} | null;
const drive = google
  ? sealSecret(openSecret(google.encrypted_refresh_token, "refresh"), "refresh")
  : null;
if (process.argv.includes("--apply")) {
  for (const p of writes)
    await rpc("provider_secret", { p_id: p.id, p_ciphertext: p.ciphertext });
  if (google && drive)
    await rpc("save_google_connection", {
      p_ciphertext: drive,
      p_scopes: google.scopes,
      p_actor: google.authorized_by,
    });
  console.log(
    `Re-encrypted ${writes.length} provider credential(s), ${drive ? 1 : 0} Drive credential. Keep previous key until consent cookies/attempts expire and refresh/read checks pass.`,
  );
} else
  console.log(
    `Dry-run: all ${writes.length} provider credential(s) and ${drive ? 1 : 0} Drive credential decrypt. No database writes.`,
  );
