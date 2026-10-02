import type { Rpc } from "../ingestion/store";
import { controlSnapshot, readiness } from "../control/service";
import type { Account, Content, Entity, Package } from "../control/model";
import { BufferClient } from "./buffer-client";
import {
  ProviderError,
  type Payload,
  type Remote,
  type Transport,
} from "./client";
import { externalWritesAllowed } from "./publishing-policy";
import { providerToken } from "./auth";
import { dispatchInputs, payloadChecksum, type Outbox } from "./outbox";
import { resolveDistributionAdapter } from "./routing";
/** Same lease as the hourly worker; never turns a cancel into a new publication. */
export async function manageDistribution(
  rpc: Rpc,
  id: string,
  demo: boolean,
  actor: string,
  operation: "cancel" | "release",
  delivery?: Payload["delivery"],
  send: Transport = fetch,
) {
  const row = (await rpc("claim_distribution_management", {
    p_id: id,
    p_demo: demo,
  })) as Outbox;
  let checkpoint: Remote = row.remote;
  const patch = (value: Record<string, unknown>) =>
    rpc("update_provider_outbox", {
      p_id: id,
      p_token: row.lease_token,
      p_patch: value,
    });
  try {
    if (operation === "cancel" && !row.remote.id) {
      if (
        row.status === "uncertain" ||
        ["dispatching", "publishing", "cancelling"].includes(
          row.remote.status ?? "",
        )
      )
        throw new ProviderError(
          "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION",
          false,
          true,
        );
      await patch({
        status: "cancelled",
        remote: { ...row.remote, status: "cancelled" },
        release: true,
      });
      return;
    }
    const { state, stories, production } = await controlSnapshot(rpc, demo);
    const account = state.entities.find((e) => e.id === row.account_id) as
      Entity<Account> | undefined;
    if (
      !account ||
      account.data.delivery_transport !== "buffer" ||
      account.data.status !== "connected" ||
      account.data.external_id !==
        (row.payload as Payload & { account_external_id: string })
          .account_external_id
    )
      throw new ProviderError("REMOTE_CANCELLATION_OR_RELEASE_UNAVAILABLE");
    const token = await providerToken(rpc, account.id, send);
    if (token.transport !== "buffer")
      throw new ProviderError("CREDENTIAL_ADAPTER_MISMATCH");
    const client = new BufferClient(
      row.provider,
      token,
      send,
      externalWritesAllowed(account.data as unknown as Record<string, unknown>),
    );
    const save = async (remote: Remote) => {
      checkpoint = remote;
      await patch({
        remote,
        status: operation === "cancel" ? "cancelling" : "dispatching",
      });
    };
    let remote: Remote;
    if (operation === "cancel")
      remote = await client.cancel(account.data.external_id!, row.remote, save);
    else {
      if (row.status !== "draft" || !delivery || delivery.mode === "draft")
        throw new ProviderError("EXISTING_DRAFT_RELEASE_REQUIRED");
      const p = state.entities.find(
        (e) => e.id === row.package_id,
      ) as unknown as Entity<Package>;
      const c = state.entities.find(
        (e) => e.id === p?.parent_id,
      ) as unknown as Entity<Content>;
      if (
        !p ||
        !c ||
        p.version !== row.package_version ||
        payloadChecksum(row.payload) !== row.checksum ||
        !readiness(c, state, stories, production, p.id).ready ||
        c.data.final_approval?.package_id !== p.id ||
        c.data.final_approval.package_version !== p.version ||
        resolveDistributionAdapter(p.data, account.data).adapter !== "buffer"
      )
        throw new ProviderError("EXACT_FINAL_APPROVAL_REQUIRED");
      if (["schedule", "queue"].includes(delivery.mode)) {
        if (
          !delivery.scheduled_at ||
          !Number.isFinite(Date.parse(delivery.scheduled_at)) ||
          Date.parse(delivery.scheduled_at) <= Date.now()
        )
          throw new ProviderError("FUTURE_SCHEDULE_REQUIRED");
        await patch({
          status: "queued",
          remote: {
            ...row.remote,
            release_authorization: {
              actor,
              at: new Date().toISOString(),
              delivery,
            },
          },
          due_at: delivery.scheduled_at,
          release: true,
        });
        return;
      }
      remote = await client.updateDraft(
        account.data.external_id!,
        row.remote,
        { ...(await dispatchInputs(rpc, row, send)), delivery },
        save,
      );
    }
    await patch({
      status: operation === "cancel" ? "cancelled" : "processing",
      remote: {
        ...remote,
        management_authorization: {
          actor,
          at: new Date().toISOString(),
          operation,
          delivery,
        },
      },
      due_at: new Date().toISOString(),
      release: true,
    });
  } catch (e) {
    const error =
      e instanceof ProviderError
        ? e
        : new ProviderError("DISTRIBUTION_MANAGEMENT_FAILED");
    await patch({
      status: error.uncertain ? "uncertain" : row.status,
      remote: checkpoint,
      error: error.code,
      release: true,
    });
    throw error;
  }
}
export async function existingOutbox(rpc: Rpc, id: string, demo: boolean) {
  // Read model excludes bearer upload URLs and lease secrets.
  return (
    (await rpc("read_provider_outbox", { p_demo: demo })) as Outbox[]
  ).find((r) => r.id === id);
}
