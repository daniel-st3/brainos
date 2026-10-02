import type { Rpc } from "../ingestion/store";
import { readControl } from "../control/service";
import { providerToken } from "./auth";
import { OfficialClient, ProviderError, type Transport } from "./client";
export async function syncSubscribers(rpc: Rpc, send: Transport = fetch) {
  if (process.env.BRAINOS_SUBSCRIBER_SYNC !== "enabled")
    return { state: "DISABLED", processed: 0 };
  const a = (await readControl(rpc, false)).entities.find(
    (e) =>
      e.kind === "account" &&
      e.data.platform === "beehiiv" &&
      e.data.status === "connected",
  );
  if (!a?.data.external_id) throw new ProviderError("AUTH_REQUIRED");
  const client = new OfficialClient(
    "beehiiv",
    await providerToken(rpc, a.id, send),
    send,
    true,
  );
  // The database prioritizes pending changes, then rotates successful remote checks.
  const rows = (await rpc("read_subscriber_sync_batch")) as {
    id: string;
    email: string;
    status: string;
    consent_at: string;
    beehiiv_id: string | null;
    sync_attempts: number;
    sync_status: string;
  }[];
  let processed = 0;
  for (const row of rows.slice(0, 100)) {
    if (!row.consent_at || row.sync_attempts >= 3) continue;
    try {
      if (row.beehiiv_id) {
        const r = (await client.request(
          `/publications/${a.data.external_id}/subscriptions/${row.beehiiv_id}`,
        )) as { data: { status: string } };
        if (r.data.status === "unsubscribed") {
          await rpc("subscriber_remote_unsubscribe", { p_id: row.id });
          continue;
        }
        if (!r.data.status)
          throw new ProviderError("SUBSCRIBER_STATUS_MISSING");
        await rpc("subscriber_sync_checked", { p_id: row.id });
      }
      if (row.sync_status === "synced" && row.status === "active") continue;
      const r = (await client.syncSubscriber(
        String(a.data.external_id),
        row.email,
        row.status === "active",
        row.beehiiv_id ?? undefined,
      )) as { data?: { id?: string } };
      const externalId = r.data?.id ?? row.beehiiv_id;
      if (!externalId) throw new ProviderError("SUBSCRIBER_ID_MISSING");
      await rpc("subscriber_sync_result", {
        p_id: row.id,
        p_external: externalId,
        p_status: "synced",
        p_expected_status: row.status,
      });
      processed++;
    } catch (e) {
      await rpc("subscriber_sync_result", {
        p_id: row.id,
        p_external: null,
        p_status: e instanceof ProviderError ? e.code : "SYNC_FAILED",
        p_expected_status: row.status,
      });
    }
  }
  return { state: "PROCESSED", processed };
}
