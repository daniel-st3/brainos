import { randomUUID, createHash } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import { controlSnapshot, readiness } from "../control/service";
import {
  type Account,
  type Content,
  type Entity,
  type Package,
  type Provider,
  type Job,
} from "../control/model";
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : v;
export const payloadChecksum = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
import {
  OfficialClient,
  ProviderError,
  type Payload,
  type Remote,
  type Transport,
} from "./client";
import { providerToken } from "./auth";
import { Simulator, type Simulation } from "./simulator";
export interface Outbox {
  id: string;
  package_id: string;
  package_version: number;
  account_id: string;
  provider: Provider;
  is_demo: boolean;
  checksum: string;
  payload: Payload;
  due_at: string;
  status: string;
  remote: Remote;
  lease_token: string;
  attempts: number;
}
export async function enqueueOutbox(
  rpc: Rpc,
  packageId: string,
  due: string,
  demo: boolean,
) {
  const { state, stories, production } = await controlSnapshot(rpc, demo),
    p = state.entities.find(
      (e) => e.id === packageId && e.kind === "package",
    ) as unknown as Entity<Package> | undefined;
  if (!p) throw Error("Package missing");
  const c = state.entities.find(
      (e) => e.id === p.parent_id,
    ) as unknown as Entity<Content>,
    a = state.entities.find(
      (e) => e.kind === "account" && e.data.platform === p.data.platform,
    ) as unknown as Entity<Account> | undefined;
  const check = readiness(c, state, stories, production, p.id);
  if (
    !check.ready ||
    c.data.final_approval?.package_id !== p.id ||
    c.data.final_approval?.package_version !== p.version
  )
    throw Error(
      "Exact final approval/current evidence/rights required: " +
        check.issues.join("; "),
    );
  if (!a || a.data.status !== "connected" || !a.data.external_id)
    throw new ProviderError("AUTH_REQUIRED");
  if (!a.data.capabilities.includes("publish"))
    throw new ProviderError("PUBLISH_CAPABILITY_UNAVAILABLE");
  const media = production.packages.find((x) => x.id === c.data.production_id)
    ?.data.output;
  const payload: Payload = {
    title: p.data.title,
    privacy: p.data.privacy,
    caption: p.data.caption,
    thread: p.data.thread,
    source_links: p.data.source_links,
    media_urls: [],
    ...(media ? { media_ref: media } : {}),
  } as Payload;
  // URLs are obtained just in time; immutable payload binds approved file checksums, not expiring tokens.
  const graphicRefs = p.data.graphic_ids.map((id) => {
    const g = state.entities.find((e) => e.id === id)!;
    return { id, version: g.version, sha256: g.data.sha256 };
  });
  const immutable = {
    ...payload,
    graphic_refs: graphicRefs,
    account_external_id: a.data.external_id,
    content_id: c.id,
    content_fingerprint: c.data.final_approval.fingerprint,
  };
  return rpc("enqueue_provider_outbox", {
    p_row: {
      id: randomUUID(),
      package_id: p.id,
      package_version: p.version,
      account_id: a.id,
      provider: p.data.platform,
      is_demo: demo,
      checksum: payloadChecksum(immutable),
      payload: immutable,
      due_at: due,
      idempotency_key: `publish:${a.id}:${p.id}:${p.version}`,
    },
  });
}
async function dispatchInputs(rpc: Rpc, row: Outbox, send: Transport) {
  const p = { ...row.payload };
  const refs = p as unknown as {
    media_ref?: {
      provider: string;
      file_id: string;
      bytes: number;
      duration: number;
      sha256: string;
      mime: string;
    };
    graphic_refs?: { id: string; version: number }[];
  };
  if (refs.media_ref) {
    const r = refs.media_ref;
    if (r.provider !== "supabase")
      throw new ProviderError("HOSTED_FINAL_MEDIA_REQUIRED");
    const { storageClient } = await import("../integrations/media");
    const { data, error } = await storageClient()
      .storage.from("brainos-production")
      .createSignedUrl(r.file_id, 7200);
    if (error || !data) throw new ProviderError("MEDIA_UNAVAILABLE");
    const { state } = await controlSnapshot(rpc, row.is_demo);
    const packageEntity = state.entities.find((e) => e.id === row.package_id)!;
    const c = state.entities.find((e) => e.id === packageEntity.parent_id)!;
    const { production } = await controlSnapshot(rpc, row.is_demo);
    const output = production.packages.find(
      (x) => x.id === c.data.production_id,
    )?.data.output;
    const probe = (
      output as unknown as {
        probe?: { width: number; height: number; codec: string };
      }
    )?.probe;
    if (!probe) throw new ProviderError("FFPROBE_VALIDATION_REQUIRED");
    p.media = { ...r, url: data.signedUrl, ...probe };
  }
  if (refs.graphic_refs?.length) {
    const { graphicRasterUrls } = await import("./raster");
    p.media_urls = await graphicRasterUrls(
      rpc,
      refs.graphic_refs,
      row.is_demo,
      row.provider === "instagram" ? "jpeg" : "png",
    );
  }
  void send;
  return p;
}
export async function processOutbox(
  rpc: Rpc,
  demo: boolean,
  send: Transport = fetch,
) {
  let processed = 0;
  const deadline = Date.now() + 210000;
  for (let n = 0; n < 10 && Date.now() < deadline; n++) {
    const row = (await rpc("claim_provider_outbox", {
      p_demo: demo,
    })) as Outbox | null;
    if (!row) break;
    const patch = async (v: Record<string, unknown>) =>
      rpc("update_provider_outbox", {
        p_id: row.id,
        p_token: row.lease_token,
        p_patch: v,
      });
    let checkpoint = row.remote;
    try {
      const { state, stories, production } = await controlSnapshot(rpc, demo),
        p = state.entities.find(
          (e) => e.id === row.package_id,
        ) as unknown as Entity<Package>,
        c = state.entities.find(
          (e) => e.id === p.parent_id,
        ) as unknown as Entity<Content>,
        a = state.entities.find(
          (e) => e.id === row.account_id,
        ) as unknown as Entity<Account>;
      if (
        !p ||
        p.version !== row.package_version ||
        payloadChecksum(row.payload) !== row.checksum
      )
        throw new ProviderError("IMMUTABLE_PAYLOAD_MISMATCH");
      if (
        !a ||
        a.data.status !== "connected" ||
        a.data.external_id !==
          (row.payload as unknown as { account_external_id: string })
            .account_external_id
      )
        throw new ProviderError("ACCOUNT_MISMATCH");
      if (row.attempts > 24 && row.status === "processing")
        throw new ProviderError("REMOTE_PROCESSING_TIMEOUT");
      const check = readiness(c, state, stories, production, p.id);
      if (!check.ready) throw new ProviderError("REVERIFY_REQUIRED");
      if (
        c.data.final_approval?.package_id !== p.id ||
        c.data.final_approval.package_version !== p.version
      )
        throw new ProviderError("FINAL_APPROVAL_REQUIRED");
      const simulation = a.data as Account & { simulation?: Simulation },
        sim = demo && a.is_demo && simulation.simulation;
      const client = sim
        ? new Simulator(row.id, simulation.simulation)
        : new OfficialClient(
            row.provider,
            await providerToken(rpc, a.id, send),
            send,
            process.env.BRAINOS_EXTERNAL_PUBLISHING === "enabled",
          );
      if (!sim && process.env.BRAINOS_EXTERNAL_PUBLISHING !== "enabled")
        throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
      let remote = row.remote;
      if (
        row.status === "dispatching" ||
        remote.status === "dispatching" ||
        remote.status === "publishing"
      ) {
        remote = await client.lookup(a.data.external_id!, remote);
        if (remote.status !== "published")
          throw new ProviderError("UNCERTAIN_WRITE_REQUIRES_RECONCILIATION");
      } else if (remote.id && remote.status !== "published") {
        remote = await client.lookup(a.data.external_id!, remote);
        if (remote.status === "container_ready")
          remote = await client.publish(
            a.data.external_id!,
            sim ? row.payload : await dispatchInputs(rpc, row, send),
            remote,
            async (r) => {
              checkpoint = r;
              await patch({
                status:
                  r.status === "publishing" ? "dispatching" : "processing",
                remote: r,
              });
            },
          );
      } else if (!remote.id) {
        await patch({ status: "dispatching" });
        remote = await client.publish(
          a.data.external_id!,
          sim ? row.payload : await dispatchInputs(rpc, row, send),
          remote,
          async (r) => {
            checkpoint = r;
            await patch({
              status:
                r.status === "dispatching" || r.status === "publishing"
                  ? "dispatching"
                  : "processing",
              remote: r,
            });
          },
        );
      }
      checkpoint = remote;
      if (remote.status === "rejected")
        throw new ProviderError("REMOTE_REJECTED");
      if (remote.status !== "published") {
        await patch({
          status: "processing",
          remote,
          due_at: new Date(Date.now() + 3600000).toISOString(),
          release: true,
        });
        continue;
      }
      const existing = state.entities.find(
        (e) =>
          e.kind === "publication" &&
          e.data.package_id === p.id &&
          e.data.package_version === p.version,
      );
      const pubId = existing?.id ?? randomUUID(),
        at = new Date().toISOString();
      if (!existing)
        await rpc("commit_control", {
          p_epoch: state.epoch,
          p_entities: [
            {
              ...c,
              version: c.version + 1,
              data: {
                ...c.data,
                distribution_state: "published",
                analytics_state: "scheduled",
              },
            },
            {
              id: pubId,
              kind: "publication",
              version: 1,
              story_id: p.story_id,
              draft_id: p.draft_id,
              parent_id: c.id,
              is_demo: demo,
              data: {
                status: "published",
                simulated: !!sim,
                package_id: p.id,
                package_version: p.version,
                platform: row.provider,
                external_id: remote.id,
                remote: {
                  id: remote.id,
                  ids: remote.ids,
                  url: remote.url,
                  status: remote.status,
                },
                url: remote.url,
                account_id: a.id,
                api_version:
                  client instanceof OfficialClient
                    ? client.provider
                    : "simulator/v1",
                published_at: at,
                content_dimensions: {
                  pillar: c.data.pillar,
                  format: c.data.format,
                  language: c.data.language,
                },
              },
            },
          ],
          p_jobs: [24, 72, 168].map((hours) => ({
            id: randomUUID(),
            kind: "analytics",
            entity_id: pubId,
            entity_version: 1,
            is_demo: demo,
            idempotency_key: `analytics:${pubId}:${hours}`,
            status: "queued",
            due_at: new Date(Date.parse(at) + hours * 3600000).toISOString(),
            input: { publication_id: pubId, hours, account_id: a.id },
            error: null,
            retryable: false,
          })),
          p_public: [],
          p_actor: "distribution-outbox",
        });
      if (!sim && remote.url)
        await rpc("attach_publication_url", {
          p_content: c.id,
          p_version: existing ? c.version : c.version + 1,
          p_url: remote.url,
        });
      await patch({
        status: "published",
        remote,
        publication_id: pubId,
        release: true,
      });
    } catch (e) {
      const err =
        e instanceof ProviderError
          ? e
          : new ProviderError("ORCHESTRATION_FAILURE");
      await patch({
        status:
          err.uncertain ||
          err.code === "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION"
            ? "uncertain"
            : err.retryable && row.attempts < 3
              ? "queued"
              : err.retryable
                ? "dead_letter"
                : "blocked",
        error: err.code,
        remote:
          err.retryable && !err.uncertain
            ? { ...checkpoint, retried: true }
            : checkpoint,
        due_at: new Date(Date.now() + err.retryAfter * 1000).toISOString(),
        release: true,
      });
    }
    processed++;
  }
  return { processed };
}
export async function captureAnalytics(
  rpc: Rpc,
  job: Job,
  demo: boolean,
  send: Transport = fetch,
) {
  const { state } = await controlSnapshot(rpc, demo),
    pub = state.entities.find(
      (e) => e.id === job.entity_id && e.kind === "publication",
    );
  if (!pub) throw new ProviderError("PUBLICATION_MISSING");
  const a = state.entities.find(
    (e) =>
      e.kind === "account" &&
      (pub.data.account_id
        ? e.id === pub.data.account_id
        : e.data.platform === pub.data.platform),
  ) as unknown as Entity<Account>;
  if (!a || a.data.status !== "connected")
    throw new ProviderError("AUTH_REQUIRED");
  const sim = demo && pub.data.simulated,
    client = sim
      ? new Simulator(pub.id)
      : new OfficialClient(
          a.data.platform,
          await providerToken(rpc, a.id, send),
          send,
        );
  const previous = (
    pub.data.metrics as { job_id?: string }[] | undefined
  )?.find((m) => m.job_id === job.id);
  if (previous) {
    await rpc("finish_control_job", {
      p_id: job.id,
      p_token: job.lease_token,
      p_status: "succeeded",
      p_result: { duplicate: true },
      p_error: null,
      p_retryable: false,
    });
    return;
  }
  const started = new Date().toISOString(),
    capture = await client.metrics(
      a.data.external_id!,
      pub.data.remote as Remote,
    ),
    record = {
      ...pub,
      version: pub.version + 1,
      data: {
        ...pub.data,
        metrics: [
          ...((pub.data.metrics as unknown[]) ?? []),
          {
            ...capture,
            job_id: job.id,
            due_at: job.due_at,
            started_at: started,
            lateness_seconds: Math.max(
              0,
              (Date.parse(capture.captured_at) - Date.parse(job.due_at)) / 1000,
            ),
            synthetic: !!sim,
          },
        ],
      },
    };
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [record],
    p_jobs: [],
    p_public: [],
    p_actor: "analytics-collector",
  });
  await rpc("finish_control_job", {
    p_id: job.id,
    p_token: job.lease_token,
    p_status: "succeeded",
    p_result: {
      captured_at: capture.captured_at,
      lateness_seconds: Math.max(
        0,
        (Date.parse(capture.captured_at) - Date.parse(job.due_at)) / 1000,
      ),
    },
    p_error: null,
    p_retryable: false,
  });
}
