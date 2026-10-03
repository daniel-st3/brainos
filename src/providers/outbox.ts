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
  ProviderError,
  type Payload,
  type Remote,
  type Transport,
} from "./client";
import { BufferClient } from "./buffer-client";
import { resolveDistributionAdapter } from "./routing";
import { externalWritesAllowed } from "./publishing-policy";
import { providerClient } from "./factory";
import { deliveryUrl } from "./delivery";
import { providerToken } from "./auth";
import { definitions } from "./definitions";
import { Simulator, type Simulation } from "./simulator";
interface ImmutablePayload extends Payload {
  candidate_authorization?: { id: string; checksum: string };
  adapter_id?: string;
  account_external_id: string;
  content_id: string;
  content_fingerprint?: string;
  publication_provenance?: {
    story_id: Entity["story_id"];
    draft_id: Entity["draft_id"];
    content_dimensions: Pick<Content, "pillar" | "format" | "language">;
  };
}

// Identity checks also apply to receipts, independently of permission to publish.
function connectionAdapter(account: Account) {
  const transport = account.delivery_transport ?? "native";
  if (transport === "buffer") {
    if (!["instagram", "tiktok", "x"].includes(account.platform))
      throw new ProviderError("BUFFER_PLATFORM_UNSUPPORTED");
    return "buffer";
  }
  if (transport !== "native")
    throw new ProviderError("UNSUPPORTED_DELIVERY_TRANSPORT");
  return account.platform === "beehiiv"
    ? "beehiiv"
    : `${account.platform}_direct`;
}

export interface Outbox {
  id: string;
  package_id: string;
  package_version: number;
  account_id: string;
  provider: Provider;
  is_demo: boolean;
  checksum: string;
  payload: ImmutablePayload;
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
  delivery?: Payload["delivery"],
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
  const simulated =
    demo &&
    a.is_demo &&
    !!(a.data as Account & { simulation?: string }).simulation;
  const adapter = simulated
    ? "simulator"
    : resolveDistributionAdapter(p.data, a.data).adapter;
  if (delivery && adapter !== "buffer")
    throw new ProviderError("BUFFER_DELIVERY_MODE_REQUIRED");
  if (
    delivery &&
    ["schedule", "queue"].includes(delivery.mode) &&
    (!delivery.scheduled_at ||
      !Number.isFinite(Date.parse(delivery.scheduled_at)) ||
      Date.parse(delivery.scheduled_at) <= Date.now())
  )
    throw new ProviderError("FUTURE_SCHEDULE_REQUIRED");
  const media = production.packages.find((x) => x.id === c.data.production_id)
    ?.data.output;
  const payload: Payload = {
    ...(delivery ? { delivery } : {}),
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
  if (adapter === "buffer" && media && graphicRefs.length)
    throw new ProviderError("BUFFER_CUSTOM_VIDEO_COVER_UNSUPPORTED");
  const immutable = {
    ...payload,
    ...(c.data.final_approval.candidate_id
      ? {
          candidate_authorization: {
            id: c.data.final_approval.candidate_id,
            checksum: c.data.final_approval.candidate_checksum!,
          },
        }
      : {}),
    adapter_id: adapter,
    graphic_refs: graphicRefs,
    account_external_id: a.data.external_id,
    content_id: c.id,
    content_fingerprint: c.data.final_approval.fingerprint,
    publication_provenance: {
      story_id: p.story_id,
      draft_id: p.draft_id,
      content_dimensions: {
        pillar: c.data.pillar,
        format: c.data.format,
        language: c.data.language,
      },
    },
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
      due_at:
        delivery && ["schedule", "queue"].includes(delivery.mode)
          ? delivery.scheduled_at!
          : due,
      idempotency_key: `publish:${a.id}:${p.id}:${p.version}`,
    },
  }) as Promise<string>;
}
export async function dispatchInputs(rpc: Rpc, row: Outbox, send: Transport) {
  const p = { ...row.payload };
  // Preserve the immutable requested schedule, but keep future approval control
  // in BrainOS. Only a due, freshly validated request reaches Buffer shareNow.
  if (p.delivery && ["schedule", "queue"].includes(p.delivery.mode))
    p.delivery = { mode: "now" };
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
  if (
    row.payload.adapter_id === "buffer" &&
    refs.media_ref &&
    refs.graphic_refs?.length
  )
    throw new ProviderError("BUFFER_CUSTOM_VIDEO_COVER_UNSUPPORTED");
  if (refs.media_ref) {
    const r = refs.media_ref;
    if (r.provider !== "supabase")
      throw new ProviderError("HOSTED_FINAL_MEDIA_REQUIRED");
    const url = await deliveryUrl(rpc, row.id, "video", r);
    const { state, production } = await controlSnapshot(rpc, row.is_demo);
    const packageEntity = state.entities.find((e) => e.id === row.package_id)!;
    const c = state.entities.find((e) => e.id === packageEntity.parent_id)!;
    const output = production.packages.find(
      (x) => x.id === c.data.production_id,
    )?.data.output;
    const probe = (
      output as unknown as {
        probe?: { width: number; height: number; codec: string };
      }
    )?.probe;
    if (!probe) throw new ProviderError("FFPROBE_VALIDATION_REQUIRED");
    p.media = { ...r, url, ...probe };
  }
  if (refs.graphic_refs?.length) {
    const { graphicRasterUrls } = await import("./raster");
    p.media_urls = await graphicRasterUrls(
      rpc,
      refs.graphic_refs,
      row.is_demo,
      ["instagram", "tiktok"].includes(row.provider) ? "jpeg" : "png",
      row.id,
    );
    const { state } = await controlSnapshot(rpc, row.is_demo);
    const format = ["instagram", "tiktok"].includes(row.provider)
      ? "jpeg"
      : "png";
    const files = refs.graphic_refs.flatMap((ref) => {
      const g = state.entities.find((e) => e.id === ref.id)!;
      return (g.data.outputs as Record<string, unknown>[]).map(
        (o) =>
          o[format] as {
            mime: string;
            bytes: number;
            width: number;
            height: number;
            sha256: string;
          },
      );
    });
    p.images = files.map((file, i) => ({ ...file, url: p.media_urls[i] }));
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
      const release = row.remote.release_authorization as
        { delivery?: Payload["delivery"] } | undefined;
      const authorization = release?.delivery ?? row.payload.delivery;
      if (authorization && ["schedule", "queue"].includes(authorization.mode)) {
        const due = Date.parse(authorization.scheduled_at ?? "");
        if (!Number.isFinite(due))
          throw new ProviderError("SCHEDULE_AUTHORIZATION_INVALID");
        if (due > Date.now()) {
          await patch({
            status: "queued",
            due_at: new Date(due).toISOString(),
            release: true,
          });
          continue;
        }
      }
      const snapshot = await controlSnapshot(rpc, demo),
        { state } = snapshot,
        p = state.entities.find(
          (e) => e.id === row.package_id && e.kind === "package",
        ) as unknown as Entity<Package> | undefined,
        c = state.entities.find(
          (e) =>
            e.id === (row.payload.content_id ?? p?.parent_id) &&
            e.kind === "content",
        ) as unknown as Entity<Content> | undefined,
        a = state.entities.find(
          (e) => e.id === row.account_id && e.kind === "account",
        ) as unknown as Entity<Account>;
      if (payloadChecksum(row.payload) !== row.checksum)
        throw new ProviderError("IMMUTABLE_PAYLOAD_MISMATCH");
      if (
        !a ||
        a.data.status !== "connected" ||
        a.data.platform !== row.provider ||
        !a.data.external_id ||
        a.data.external_id !== row.payload.account_external_id
      )
        throw new ProviderError("ACCOUNT_MISMATCH");
      if (
        row.attempts > 24 &&
        row.status === "processing" &&
        row.remote.status !== "scheduled"
      )
        throw new ProviderError("REMOTE_PROCESSING_TIMEOUT");
      const approvalError = (
        current: typeof snapshot,
      ): ProviderError | null => {
        const pkg = current.state.entities.find(
          (e) => e.id === row.package_id && e.kind === "package",
        ) as unknown as Entity<Package> | undefined;
        const content = current.state.entities.find(
          (e) =>
            e.id === (row.payload.content_id ?? pkg?.parent_id) &&
            e.kind === "content",
        ) as unknown as Entity<Content> | undefined;
        if (
          !pkg ||
          !content ||
          pkg.version !== row.package_version ||
          pkg.parent_id !== content.id ||
          pkg.data.platform !== row.provider
        )
          return new ProviderError("IMMUTABLE_PAYLOAD_MISMATCH");
        try {
          if (
            !readiness(
              content,
              current.state,
              current.stories,
              current.production,
              pkg.id,
            ).ready
          )
            return new ProviderError("REVERIFY_REQUIRED");
        } catch {
          return new ProviderError("REVERIFY_REQUIRED");
        }
        if (
          content.data.final_approval?.package_id !== pkg.id ||
          content.data.final_approval.package_version !== row.package_version ||
          (row.payload.content_fingerprint &&
            content.data.final_approval.fingerprint !==
              row.payload.content_fingerprint)
        )
          return new ProviderError("FINAL_APPROVAL_REQUIRED");
        return null;
      };
      const currentApproval = !approvalError(snapshot);
      const simulation = a.data as Account & { simulation?: Simulation },
        sim = demo && a.is_demo && simulation.simulation;
      const adapter = sim ? "simulator" : connectionAdapter(a.data);
      const boundAdapter = row.payload.adapter_id;
      if (boundAdapter && boundAdapter !== adapter)
        throw new ProviderError("IMMUTABLE_ADAPTER_MISMATCH");
      const requireWrite = async () => {
        const latest = await controlSnapshot(rpc, demo);
        const error = approvalError(latest);
        if (error) throw error;
        if (row.payload.candidate_authorization) {
          const { assertCurrent } = await import("../approval/service");
          const candidate = latest.state.entities.find(
            (e) => e.id === row.payload.candidate_authorization!.id,
          );
          const approval = latest.state.entities.find(
            (e) => e.id === row.payload.content_id,
          )?.data.final_approval as Content["final_approval"];
          if (
            !candidate ||
            candidate.data.checksum !==
              row.payload.candidate_authorization.checksum ||
            !["APPROVED", "QUEUED"].includes(String(candidate.data.state)) ||
            (candidate.data.decision as { decision?: string })?.decision !==
              "approve" ||
            approval?.candidate_id !== candidate.id ||
            approval.candidate_checksum !== candidate.data.checksum
          )
            throw new ProviderError("EXACT_CANDIDATE_APPROVAL_REQUIRED");
          const frozen = candidate.data.frozen as { due_at: string | null };
          if (frozen.due_at && Date.parse(frozen.due_at) > Date.now())
            throw new ProviderError("CANDIDATE_SCHEDULE_NOT_DUE");
          assertCurrent(
            latest,
            candidate as unknown as import("../approval/service").Review,
          );
        }
        const account = latest.state.entities.find(
          (e) => e.id === row.account_id && e.kind === "account",
        ) as unknown as Entity<Account> | undefined;
        if (
          !account ||
          account.data.status !== "connected" ||
          account.data.external_id !== row.payload.account_external_id ||
          account.data.platform !== row.provider
        )
          throw new ProviderError("ACCOUNT_MISMATCH");
        if (!sim) {
          if (
            resolveDistributionAdapter({ platform: row.provider }, account.data)
              .adapter !== adapter
          )
            throw new ProviderError("IMMUTABLE_ADAPTER_MISMATCH");
          if (
            !externalWritesAllowed(
              account.data as unknown as Record<string, unknown>,
            )
          )
            throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
        }
      };
      // New/resumed writes need current approval before even preparing inputs.
      // An existing remote ID can always be read on its original connection.
      if (!row.remote.id) await requireWrite();
      const tokens = sim ? null : await providerToken(rpc, a.id, send);
      if (
        tokens &&
        (tokens.transport ?? "native") !==
          (a.data.delivery_transport ?? "native")
      )
        throw new ProviderError("CREDENTIAL_ADAPTER_MISMATCH");
      if (tokens?.account_id && tokens.account_id !== a.data.external_id)
        throw new ProviderError("ACCOUNT_MISMATCH");
      const client = sim
        ? new Simulator(row.id, simulation.simulation)
        : providerClient(
            row.provider,
            tokens!,
            send,
            externalWritesAllowed(a.data as unknown as Record<string, unknown>),
          );
      let remote = row.remote;
      if (
        row.status === "dispatching" ||
        remote.status === "dispatching" ||
        remote.status === "publishing"
      ) {
        remote = await client.lookup(a.data.external_id!, remote);
        checkpoint = remote;
        if (remote.status !== "published")
          throw new ProviderError("UNCERTAIN_WRITE_REQUIRES_RECONCILIATION");
      } else if (remote.id && remote.status !== "published") {
        remote = await client.lookup(a.data.external_id!, remote);
        checkpoint = remote;
        if (
          remote.status === "draft" &&
          row.remote.release_authorization &&
          client instanceof BufferClient
        ) {
          await requireWrite();
          remote = await client.updateDraft(
            a.data.external_id!,
            remote,
            {
              ...(await dispatchInputs(rpc, row, send)),
              delivery: { mode: "now" },
              publish_at: undefined,
            },
            async (r) => {
              checkpoint = r;
              await patch({ status: "processing", remote: r });
            },
          );
        } else if (remote.status === "container_ready") {
          await requireWrite();
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
        }
      } else if (!remote.id) {
        await requireWrite();
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
      if (["uncertain", "manual_action_required"].includes(remote.status ?? ""))
        throw new ProviderError(
          remote.status === "uncertain"
            ? "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION"
            : "BUFFER_NOTIFICATION_ACTION_REQUIRED",
          false,
          remote.status === "uncertain",
        );
      if (remote.status === "draft") {
        await patch({ status: "draft", remote, release: true });
        continue;
      }
      if (remote.status === "rejected")
        throw new ProviderError("REMOTE_REJECTED");
      if (remote.status !== "published") {
        await patch({
          status: "processing",
          remote,
          due_at: new Date(
            Math.max(
              Date.now() + Math.max(3600, remote.retry_after ?? 0) * 1000,
              remote.status === "scheduled"
                ? Date.parse(String(remote.due_at)) || 0
                : 0,
            ),
          ).toISOString(),
          release: true,
        });
        continue;
      }
      const existing = state.entities.find(
        (e) =>
          e.kind === "publication" &&
          e.data.package_id === row.package_id &&
          e.data.package_version === row.package_version,
      );
      const pubId = existing?.id ?? randomUUID(),
        observedAt = new Date().toISOString(),
        providerTime = Date.parse(remote.published_at ?? ""),
        hasProviderTime =
          Number.isFinite(providerTime) && providerTime <= Date.now(),
        at = hasProviderTime
          ? new Date(providerTime).toISOString()
          : observedAt;
      if (!existing)
        await rpc("commit_control", {
          p_epoch: state.epoch,
          p_entities: [
            ...(currentApproval && c
              ? [
                  {
                    ...c,
                    version: c.version + 1,
                    data: {
                      ...c.data,
                      distribution_state: "published",
                      analytics_state: "scheduled",
                    },
                  },
                ]
              : []),
            {
              id: pubId,
              kind: "publication",
              version: 1,
              story_id:
                row.payload.publication_provenance?.story_id ??
                p?.story_id ??
                null,
              draft_id:
                row.payload.publication_provenance?.draft_id ??
                p?.draft_id ??
                null,
              parent_id: row.payload.content_id ?? c?.id ?? null,
              is_demo: demo,
              data: {
                status: "published",
                simulated: !!sim,
                package_id: row.package_id,
                package_version: row.package_version,
                approval_current_at_receipt: currentApproval,
                platform: row.provider,
                external_id: remote.id,
                remote: {
                  id: remote.id,
                  ids: remote.ids,
                  url: remote.url,
                  status: remote.status,
                  buffer_channel_id: remote.buffer_channel_id,
                  transport: remote.transport,
                },
                url: remote.url,
                account_id: a.id,
                account_external_id: row.payload.account_external_id,
                adapter_id: adapter,
                api_version: sim
                  ? "simulator/v1"
                  : a.data.delivery_transport === "buffer"
                    ? `buffer/${row.provider}/2026-10-02`
                    : `${row.provider}/${definitions[row.provider].version}`,
                published_at: at,
                first_observed_at: observedAt,
                publication_time_basis: hasProviderTime
                  ? "provider_reported"
                  : "first_observed",
                content_dimensions: row.payload.publication_provenance
                  ?.content_dimensions ?? {
                  pillar: c?.data.pillar,
                  format: c?.data.format,
                  language: c?.data.language,
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
      if (!sim && remote.url && currentApproval && c)
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
  if (
    a.data.platform !== pub.data.platform ||
    !a.data.external_id ||
    (pub.data.account_external_id &&
      a.data.external_id !== pub.data.account_external_id)
  )
    throw new ProviderError("ACCOUNT_MISMATCH");
  const sim = demo && pub.data.simulated;
  if (
    !sim &&
    pub.data.adapter_id &&
    connectionAdapter(a.data) !== pub.data.adapter_id
  )
    throw new ProviderError("IMMUTABLE_ADAPTER_MISMATCH");
  const tokens = sim ? null : await providerToken(rpc, a.id, send);
  if (
    tokens &&
    (tokens.transport ?? "native") !== (a.data.delivery_transport ?? "native")
  )
    throw new ProviderError("CREDENTIAL_ADAPTER_MISMATCH");
  if (tokens?.account_id && tokens.account_id !== a.data.external_id)
    throw new ProviderError("ACCOUNT_MISMATCH");
  const client = sim
    ? new Simulator(pub.id)
    : providerClient(a.data.platform, tokens!, send);
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
