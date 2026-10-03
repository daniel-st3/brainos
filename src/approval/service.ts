import { randomUUID } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import { controlSnapshot, readControl, readiness } from "../control/service";
import type { Account, Content, Entity, Package } from "../control/model";
import { enqueueOutbox, payloadChecksum } from "../providers/outbox";
import { resolveDistributionAdapter } from "../providers/routing";
import { externalWritesAllowed } from "../providers/publishing-policy";
import { decisionInput, type Candidate, type ReviewMedia } from "./model";
type Snapshot = Awaited<ReturnType<typeof controlSnapshot>>;
export type Review = Entity<Candidate>;
export const isReview = (e: Entity): boolean =>
  e.kind === "review" && e.data.type === "cloud_approval_v1";
export async function findReview(rpc: Rpc, id: string): Promise<Review> {
  const all = await readControl(rpc, false);
  const row =
    all.entities.find((e) => e.id === id && isReview(e)) ??
    (await readControl(rpc, true)).entities.find(
      (e) => e.id === id && isReview(e),
    );
  if (!row) throw Error("REVIEW_NOT_FOUND");
  return row as unknown as Review;
}
function freeze(
  s: Snapshot,
  packageId: string,
  due: string | null,
  demo: boolean,
): Candidate["frozen"] {
  const p = s.state.entities.find(
    (e) => e.id === packageId && e.kind === "package",
  ) as unknown as Entity<Package>;
  const c = s.state.entities.find(
    (e) => e.id === p?.parent_id && e.kind === "content",
  ) as unknown as Entity<Content>;
  if (!p || !c) throw Error("PACKAGE_NOT_FOUND");
  const check = readiness(c, s.state, s.stories, s.production, p.id);
  if (!check.ready)
    throw Error("CANDIDATE_NOT_READY: " + check.issues.join("; "));
  const a = s.state.entities.find(
    (e) => e.kind === "account" && e.data.platform === p.data.platform,
  ) as unknown as Entity<Account>;
  if (
    !a ||
    a.data.status !== "connected" ||
    !a.data.external_id ||
    !a.data.capabilities.includes("publish")
  )
    throw Error("CONNECTED_PUBLISH_TARGET_REQUIRED");
  const simulated =
    demo &&
    a.is_demo &&
    !!(a.data as Account & { simulation?: string }).simulation;
  // A demo may never fall through to a live adapter, even with a live credential installed.
  if (demo && !simulated) throw Error("STAGING_SIMULATOR_REQUIRED");
  const adapter = simulated
    ? "simulator"
    : resolveDistributionAdapter(p.data, a.data).adapter;
  if (
    !simulated &&
    !externalWritesAllowed(a.data as unknown as Record<string, unknown>)
  )
    throw Error("ACCOUNT_SEND_AUTHORIZATION_REQUIRED");
  const media: ReviewMedia[] = [];
  const output = s.production.packages.find(
    (x) => x.id === c.data.production_id,
  )?.data.output;
  if (output) {
    if (output.provider !== "supabase")
      throw Error("HOSTED_FINAL_MEDIA_REQUIRED");
    media.push({
      file_id: output.file_id,
      sha256: output.sha256,
      mime: output.mime,
      bytes: output.bytes,
    });
  }
  const graphics = p.data.graphic_ids.map((id) =>
    s.state.entities.find((e) => e.id === id)!,
  );
  for (const g of graphics) {
    for (const o of g.data.outputs as Record<string, unknown>[]) {
      const file = o[
        ["instagram", "tiktok"].includes(p.data.platform) ? "jpeg" : "png"
      ] as ReviewMedia & { source_svg_sha256: string };
      if (!file || file.source_svg_sha256 !== o.sha256)
        throw Error("FINAL_RASTER_REQUIRED");
      media.push({
        file_id: file.file_id,
        sha256: file.sha256,
        mime: file.mime,
        bytes: file.bytes,
        graphic_id: g.id,
        graphic_version: g.version,
        source_sha256: String(o.sha256),
      });
    }
  }
  if (adapter === "buffer" && output && graphics.length)
    throw Error("BUFFER_MIXED_MEDIA_UNSUPPORTED");
  if (
    media.some(
      (m) =>
        !/^[a-f0-9]{64}$/.test(m.sha256) ||
        !["image/png", "image/jpeg", "video/mp4"].includes(m.mime),
    )
  )
    throw Error("INVALID_FINAL_MEDIA");
  const story = s.stories.find((x) => x.id === c.story_id)!;
  const {
    final_approval: _approval,
    distribution_state: _distribution,
    analytics_state: _analytics,
    production_state: _production,
    ...editorial
  } = c.data;
  void _approval;
  void _distribution;
  void _analytics;
  void _production;
  return {
    package_id: p.id,
    package_version: p.version,
    content_id: c.id,
    story_id: story.id,
    draft_id: p.data.draft_id,
    draft_revision: p.data.draft_revision,
    title: p.data.title,
    caption: p.data.caption,
    thread: p.data.thread,
    platform: p.data.platform,
    account_id: a.id,
    account_external_id: a.data.external_id,
    handle: a.data.handle,
    adapter,
    due_at: due,
    sources: p.data.source_links,
    media,
    simulated,
    binding: payloadChecksum({
      editorial,
      story,
      package: p,
      graphics,
      production:
        s.production.packages.find((x) => x.id === c.data.production_id) ??
        null,
      creative: s.state.entities
        .filter((e) => e.kind === "creative" && e.parent_id === c.id)
        .map((e) => ({ id: e.id, version: e.version, data: e.data })),
    }),
  };
}
async function commit(
  rpc: Rpc,
  epoch: number,
  entities: (Entity | Review)[],
  actor: string,
) {
  await rpc("commit_control", {
    p_epoch: epoch,
    p_entities: entities,
    p_jobs: [],
    p_public: [],
    p_actor: actor,
  });
}
export async function createCandidate(
  rpc: Rpc,
  packageId: string,
  due: string | null,
  demo: boolean,
) {
  if (
    due &&
    (!Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.now())
  )
    throw Error("FUTURE_SCHEDULE_REQUIRED");
  const s = await controlSnapshot(rpc, demo),
    frozen = freeze(s, packageId, due, demo),
    checksum = payloadChecksum(frozen);
  const prior = s.state.entities.filter(
    (e) =>
      isReview(e) &&
      (e.data.frozen as Candidate["frozen"]).package_id === packageId,
  ) as unknown as Review[];
  const same = prior.find((e) => e.data.checksum === checksum);
  if (same) return same;
  const existingOutbox = (await rpc("read_provider_outbox", {
    p_demo: demo,
  })) as { package_id: string }[];
  if (existingOutbox.some((o) => o.package_id === packageId))
    throw Error("NEW_PACKAGE_REVISION_REQUIRED");
  if (prior.some((e) => ["APPROVED", "QUEUED"].includes(e.data.state)))
    throw Error("NEW_PACKAGE_REVISION_REQUIRED");
  const now = new Date().toISOString(),
    id = randomUUID();
  const review: Review = {
    id,
    kind: "review",
    version: 1,
    parent_id: frozen.content_id,
    story_id: frozen.story_id,
    draft_id: frozen.draft_id,
    is_demo: demo,
    data: {
      type: "cloud_approval_v1",
      checksum,
      frozen,
      state: "AWAITING_DANIEL",
      created_at: now,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      decision: null,
      wait_token_id: null,
      outbox_id: null,
    },
  };
  const notification: Entity = {
    id: randomUUID(),
    kind: "notification",
    version: 1,
    story_id: frozen.story_id,
    draft_id: frozen.draft_id,
    parent_id: id,
    is_demo: demo,
    data: {
      key: `approval:${id}`,
      title: "DVNI post ready for review",
      href: `/review/${id}`,
      status: "unread",
      created_at: now,
      read_at: null,
      transport: "in_app",
      external_delivery: "NOT_CONFIGURED",
    },
  };
  await commit(
    rpc,
    s.state.epoch,
    [
      ...prior
        .filter((e) => e.data.state === "AWAITING_DANIEL")
        .map((e) => ({
          ...e,
          version: e.version + 1,
          data: { ...e.data, state: "STALE" as const },
        })),
      review,
      notification,
    ],
    "cloud-candidate",
  );
  return review;
}
export function assertCurrent(s: Snapshot, row: Review) {
  if (
    payloadChecksum(row.data.frozen) !== row.data.checksum ||
    payloadChecksum(
      freeze(
        s,
        row.data.frozen.package_id,
        row.data.frozen.due_at,
        row.is_demo,
      ),
    ) !== row.data.checksum
  )
    throw Error("STALE_CANDIDATE");
}
export async function decideCandidate(
  rpc: Rpc,
  id: string,
  raw: unknown,
  actor: string,
) {
  const input = decisionInput.parse(raw),
    row = await findReview(rpc, id),
    d = row.data;
  if (input.checksum !== d.checksum) throw Error("STALE_CANDIDATE");
  if (d.decision) {
    if (
      d.decision.decision === input.decision &&
      d.decision.actor === actor &&
      d.decision.feedback === input.feedback
    )
      return row;
    throw Error("DECISION_ALREADY_RECORDED");
  }
  if (d.state !== "AWAITING_DANIEL" || Date.parse(d.expires_at) <= Date.now())
    throw Error("REVIEW_CLOSED");
  const s = await controlSnapshot(rpc, row.is_demo);
  const current = s.state.entities.find((e) => e.id === row.id)!;
  if (current.version !== row.version) throw Error("Conflict: refresh review");
  if (input.decision === "approve") {
    assertCurrent(s, row);
    if (d.frozen.due_at && Date.parse(d.frozen.due_at) <= Date.now())
      throw Error("SCHEDULE_PASSED_CREATE_NEW_CANDIDATE");
  }
  const now = new Date().toISOString();
  const updated: Review = {
    ...row,
    version: row.version + 1,
    data: {
      ...d,
      state:
        input.decision === "approve"
          ? "APPROVED"
          : input.decision === "reject"
            ? "REJECTED"
            : "REQUEST_CHANGES",
      decision: { ...input, actor, at: now },
    },
  };
  const c = s.state.entities.find((e) => e.id === d.frozen.content_id)!;
  const entities: (Entity | Review)[] = [updated];
  if (input.decision === "approve")
    entities.push({
      ...c,
      version: c.version + 1,
      data: {
        ...c.data,
        distribution_state: "ready",
        final_approval: {
          actor,
          at: now,
          fingerprint: (
            s.state.entities.find((e) => e.id === d.frozen.package_id)!
              .data as unknown as Package
          ).fingerprint,
          package_id: d.frozen.package_id,
          package_version: d.frozen.package_version,
          candidate_id: row.id,
          candidate_checksum: d.checksum,
        },
      },
    });
  if (input.decision === "request_changes")
    entities.push({
      id: randomUUID(),
      kind: "notification",
      version: 1,
      parent_id: row.id,
      story_id: row.story_id,
      draft_id: row.draft_id,
      is_demo: row.is_demo,
      data: {
        key: `changes:${row.id}`,
        title: "Changes requested — create a new revision",
        href: `/stories/${row.story_id}?tab=drafts`,
        status: "unread",
        created_at: now,
        feedback: input.feedback,
      },
    });
  await commit(rpc, s.state.epoch, entities, actor);
  return updated;
}
export async function attachWaitToken(rpc: Rpc, id: string, token: string) {
  const r = await findReview(rpc, id);
  if (r.data.wait_token_id) return r.data.wait_token_id;
  const s = await readControl(rpc, r.is_demo);
  await commit(
    rpc,
    s.epoch,
    [
      {
        ...r,
        version: r.version + 1,
        data: { ...r.data, wait_token_id: token },
      },
    ],
    "cloud-wait",
  );
  return token;
}
export async function resumeCandidate(rpc: Rpc, id: string) {
  const r = await findReview(rpc, id);
  if (
    r.data.decision?.decision !== "approve" ||
    !["APPROVED", "QUEUED"].includes(r.data.state)
  )
    return { state: r.data.state, outbox_id: null };
  if (r.data.outbox_id) return { state: "QUEUED", outbox_id: r.data.outbox_id };
  const s = await controlSnapshot(rpc, r.is_demo);
  assertCurrent(s, r);
  const c = s.state.entities.find((e) => e.id === r.data.frozen.content_id)!;
  const approval = c.data.final_approval as {
    candidate_id?: string;
    candidate_checksum?: string;
  };
  if (
    approval?.candidate_id !== r.id ||
    approval.candidate_checksum !== r.data.checksum
  )
    throw Error("EXACT_CANDIDATE_APPROVAL_REQUIRED");
  const outbox = await enqueueOutbox(
    rpc,
    r.data.frozen.package_id,
    r.data.frozen.due_at ?? new Date().toISOString(),
    r.is_demo,
  );
  const latest = await findReview(rpc, id),
    state = await readControl(rpc, r.is_demo);
  await commit(
    rpc,
    state.epoch,
    [
      {
        ...latest,
        version: latest.version + 1,
        data: { ...latest.data, state: "QUEUED", outbox_id: outbox },
      },
    ],
    "cloud-resume",
  );
  return { state: "QUEUED", outbox_id: outbox };
}

export async function expireCandidate(rpc: Rpc, id: string) {
  const r = await findReview(rpc, id);
  if (r.data.decision || r.data.state !== "AWAITING_DANIEL") return;
  const state = await readControl(rpc, r.is_demo);
  await commit(
    rpc,
    state.epoch,
    [{ ...r, version: r.version + 1, data: { ...r.data, state: "EXPIRED" } }],
    "cloud-approval-expired",
  );
}
