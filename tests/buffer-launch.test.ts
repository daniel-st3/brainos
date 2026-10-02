import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  controlAction,
  controlSnapshot,
  readControl,
} from "../src/control/service";
import {
  enqueueOutbox,
  processOutbox,
  captureAnalytics,
  dispatchInputs,
  type Outbox,
} from "../src/providers/outbox";
import { sealSecret } from "../src/integrations/google-oauth";
import type { Entity, Job, Package, Provider } from "../src/control/model";
import type { Remote, TokenSet, Transport } from "../src/providers/client";
import { bufferApi } from "../src/providers/buffer-client";
import { manageDistribution } from "../src/providers/management";

// PGlite and injected HTTP fixtures exercise the real transport; no live accounts or sends.
let db: PGlite;
let rpc: Rpc;
let unexpectedFetch: ReturnType<typeof vi.fn<Transport>>;
const fixtureKey = "buffer-fixture-NOT-A-REAL-KEY";
const channelId = "buffer-channel-fixture";
const postId = "buffer-post-fixture";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const run = (command: unknown) =>
  controlAction(rpc, command, "Daniel demo", true);

beforeEach(async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("BRAINOS_EXTERNAL_PUBLISHING", "enabled");
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "false");
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
  const brand = await run({
    action: "brand_save",
    name: "DEMO",
    positioning: "DEMO applied AI",
    audience: "Operators",
    pillars: ["Evidence"],
    tone: ["Specific"],
    cta: "Inspect evidence",
  });
  await run({ action: "brand_approve", id: brand.id, confirmed: true });
  unexpectedFetch = vi.fn<Transport>(async () => {
    throw Error("Uninjected HTTP is forbidden in launch fixtures");
  });
  vi.stubGlobal("fetch", unexpectedFetch);
});
afterEach(async () => {
  await db.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  expect(unexpectedFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function approvedFixture(
  transport: "buffer" | "native" = "buffer",
  thread: string[] = [],
  platform: Provider = "x",
) {
  const story = (await controlSnapshot(rpc, true)).stories.find(
    (s) => s.status === "approved",
  )!;
  const idea = await run({
    action: "idea_create",
    title: "DEMO launch fixture",
    source: "story",
    story_id: story.id,
    provenance: "Fictional fixture only",
  });
  await run({ action: "idea_transition", id: idea.id, target: "qualified" });
  await run({ action: "idea_transition", id: idea.id, target: "selected" });
  const content = await run({
    action: "content_create",
    idea_id: idea.id,
    platform,
    format: "post",
    purpose: "Verify complete distribution",
  });
  await run({
    action: "content_bind",
    id: content.id,
    draft_id: story.active_draft_id,
  });
  await run({
    action: "content_freshness",
    id: content.id,
    evergreen: true,
    fresh_until: null,
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id: content.id,
    target: "review",
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id: content.id,
    target: "approved",
    confirmed: true,
  });
  const pkg = await run({
    action: "package_create",
    id: content.id,
    title: "DEMO launch",
    caption: "DEMO verified workflow.",
    cta: "Inspect evidence.",
    thread,
    graphic_ids: [],
  });
  await run({ action: "package_approve", id: pkg.id, confirmed: true });
  await run({
    action: "content_final",
    id: content.id,
    package_id: pkg.id,
    confirmed: true,
  });
  await run({
    action: "account_create",
    platform,
    handle: "fixture-not-live",
  });
  const state = await readControl(rpc, true),
    account = state.entities.find(
      (e) => e.kind === "account" && e.data.platform === platform,
    )!;
  const token: TokenSet = {
    ...(transport === "buffer" ? { transport: "buffer" } : {}),
    access_token: fixtureKey,
    account_id: channelId,
    expires_at: Date.now() + 30 * 86400000,
    scopes: ["tweet.write", "tweet.read"],
  };
  await rpc("install_provider_connection", {
    p_epoch: state.epoch,
    p_entity: {
      ...account,
      version: account.version + 1,
      data: {
        ...account.data,
        status: "connected",
        external_id: channelId,
        delivery_transport: transport,
        verified_at: new Date().toISOString(),
        capabilities: ["profile_read", "publish", "schedule"],
        reason: null,
      },
    },
    p_ciphertext: sealSecret(JSON.stringify(token), `provider:${account.id}`),
    p_actor: "fixture-installation",
  });
  return {
    packageId: pkg.id!,
    accountId: account.id,
    package: state.entities.find(
      (e) => e.id === pkg.id,
    ) as unknown as Entity<Package>,
  };
}

type GraphRequest = {
  query: string;
  variables: { input: Record<string, unknown> };
};
function bufferFixture() {
  let status = "scheduled";
  let scheduledAt: string | null = null;
  const calls: GraphRequest[] = [];
  const publishedAt = new Date(Date.now() - 2 * 3600000).toISOString();
  const capturedAt = new Date().toISOString();
  const post = () => ({
    id: postId,
    channelId,
    channelService: "twitter",
    status,
    sentAt: status === "sent" ? publishedAt : null,
    dueAt: scheduledAt,
    externalLink:
      status === "sent" ? "https://x.com/fixture/status/100001" : null,
    schedulingType: "automatic",
    allowedActions: status === "sent" ? [] : ["updatePost", "deletePost"],
  });
  const send = vi.fn<Transport>(async (url, init) => {
    expect(url).toBe(bufferApi);
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${fixtureKey}`,
    });
    const body = JSON.parse(String(init?.body)) as GraphRequest;
    calls.push(body);
    if (body.query.includes("query BufferChannel(")) {
      expect(body.variables.input.id).toBe(channelId);
      return json({
        data: {
          channel: {
            id: channelId,
            service: "twitter",
            serviceId: "social-account-fixture",
            organizationId: "fixture-org",
            name: "fixture-not-live",
            displayName: "DEMO",
            type: "business",
            isDisconnected: false,
            isLocked: false,
            isQueuePaused: false,
            allowedActions: ["scheduleUpdates"],
            scopes: [],
          },
        },
      });
    }
    if (body.query.includes("mutation BufferCreatePost(")) {
      expect(body.variables.input.channelId).toBe(channelId);
      expect(body.variables.input.schedulingType).toBe("automatic");
      scheduledAt =
        typeof body.variables.input.dueAt === "string"
          ? body.variables.input.dueAt
          : null;
      status =
        body.variables.input.saveToDraft === true ? "draft" : "scheduled";
      return json({
        data: { createPost: { __typename: "PostActionSuccess", post: post() } },
      });
    }
    if (body.query.includes("mutation BufferEditPost(")) {
      expect(body.variables.input.id).toBe(postId);
      expect(body.variables.input).not.toHaveProperty("channelId");
      scheduledAt =
        typeof body.variables.input.dueAt === "string"
          ? body.variables.input.dueAt
          : null;
      status =
        body.variables.input.saveToDraft === true ? "draft" : "scheduled";
      return json({
        data: { editPost: { __typename: "PostActionSuccess", post: post() } },
      });
    }
    if (body.query.includes("mutation BufferDeletePost(")) {
      expect(body.variables.input.id).toBe(postId);
      status = "deleted";
      return json({
        data: { deletePost: { __typename: "DeletePostSuccess", id: postId } },
      });
    }
    if (body.query.includes("query BufferPostMetrics(")) {
      expect(body.variables.input.id).toBe(postId);
      return json({
        data: {
          post: {
            ...post(),
            metrics: [
              {
                type: "impressions",
                name: "Impressions",
                value: 42,
                unit: "count",
              },
              {
                type: "engagement_rate",
                name: "Engagement rate",
                value: 7.1,
                unit: "percentage",
              },
            ],
            metricsUpdatedAt: capturedAt,
          },
        },
      });
    }
    if (body.query.includes("query BufferPost(")) {
      expect(body.variables.input.id).toBe(postId);
      if (status === "deleted")
        return json({
          errors: [
            {
              message: "Fixture post was deleted",
              extensions: { code: "NOT_FOUND" },
            },
          ],
        });
      return json({ data: { post: post() } });
    }
    throw Error("Unrecognized GraphQL fixture operation");
  });
  return {
    send,
    calls,
    publishedAt,
    capturedAt,
    markSent: () => {
      status = "sent";
    },
    markDeleted: () => {
      status = "deleted";
    },
  };
}
async function dueNow(id: string) {
  await db.query(
    "update provider_outbox set due_at=now()-interval '1 second' where id=$1",
    [id],
  );
}
async function advanceSchedule(id: string, scheduledAt: string) {
  // Move the test job's DB clock eligibility independently of the immutable payload.
  await dueNow(id);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(scheduledAt) + 1000);
}
async function outbox(id: string) {
  const rows = (await rpc("read_provider_outbox", { p_demo: true })) as {
    id: string;
    status: string;
    due_at: string;
    error: string;
    payload: Record<string, unknown>;
    remote: Remote;
  }[];
  return rows.find((row) => row.id === id)!;
}

it("publishes an approved package once through real Buffer transport, then captures provider metrics at the exact analytics windows", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    due = new Date(Date.now() - 1000).toISOString(),
    id = await enqueueOutbox(rpc, fixture.packageId, due, true);
  expect(await enqueueOutbox(rpc, fixture.packageId, due, true)).toBe(id);
  expect((await outbox(String(id))).payload.adapter_id).toBe("buffer");
  expect(JSON.stringify(await rpc("read_control"))).not.toContain(fixtureKey);
  expect(
    await rpc("provider_secret", { p_id: fixture.accountId }),
  ).not.toContain(fixtureKey);

  await processOutbox(rpc, true, provider.send);
  expect(await outbox(String(id))).toMatchObject({
    status: "processing",
    remote: { id: postId, status: "scheduled", transport: "buffer" },
  });
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) => e.kind === "publication",
    ),
  ).toHaveLength(0);
  expect(
    (await readControl(rpc, true)).jobs.filter(
      (job) => job.kind === "analytics",
    ),
  ).toHaveLength(0);

  await dueNow(String(id));
  await processOutbox(rpc, true, provider.send);
  expect((await outbox(String(id))).status).toBe("processing");
  provider.markSent();
  await dueNow(String(id));
  await processOutbox(rpc, true, provider.send);
  await processOutbox(rpc, true, provider.send);
  expect((await outbox(String(id))).status).toBe("published");
  expect(
    provider.calls.filter((call) =>
      call.query.includes("mutation BufferCreatePost("),
    ),
  ).toHaveLength(1);
  const state = await readControl(rpc, true),
    publications = state.entities.filter(
      (e) =>
        e.kind === "publication" && e.data.package_id === fixture.packageId,
    ),
    publication = publications[0];
  expect(publications).toHaveLength(1);
  expect(publication.data).toMatchObject({
    external_id: postId,
    published_at: provider.publishedAt,
    publication_time_basis: "provider_reported",
    simulated: false,
    remote: { id: postId, transport: "buffer", buffer_channel_id: channelId },
  });
  const jobs = state.jobs.filter(
    (job) => job.kind === "analytics" && job.entity_id === publication.id,
  );
  expect(jobs).toHaveLength(3);
  expect(
    jobs.map((job) => Number(job.input.hours)).sort((a, b) => a - b),
  ).toEqual([24, 72, 168]);
  for (const job of jobs)
    expect(Date.parse(job.due_at) - Date.parse(provider.publishedAt)).toBe(
      Number(job.input.hours) * 3600000,
    );

  const first = jobs.find((job) => job.input.hours === 24)!;
  await db.query(
    "update control_jobs set due_at=now()-interval '1 minute' where id=$1",
    [first.id],
  );
  const claimed = (await rpc("claim_control_job", {
    p_kind: "analytics",
    p_demo: true,
  })) as Job;
  expect(claimed.id).toBe(first.id);
  await captureAnalytics(rpc, claimed, true, provider.send);
  const after = await readControl(rpc, true),
    metrics = after.entities.find((e) => e.id === publication.id)!.data
      .metrics as Record<string, unknown>[];
  expect(metrics).toHaveLength(1);
  expect(metrics[0]).toMatchObject({
    values: { impressions: 42, engagement_rate: 7.1 },
    semantics: "buffer/x/2026-10-02",
    raw: { metricsUpdatedAt: provider.capturedAt },
    synthetic: false,
    job_id: first.id,
  });
  expect(Date.parse(String(metrics[0].captured_at))).toBeGreaterThanOrEqual(
    Date.parse(provider.capturedAt),
  );
  expect(after.jobs.find((job) => job.id === first.id)?.status).toBe(
    "succeeded",
  );
  expect(
    provider.calls.filter((call) =>
      call.query.includes("query BufferPostMetrics("),
    ),
  ).toHaveLength(1);
});

it("blocks a changed delivery adapter before any HTTP or account switch", async () => {
  const fixture = await approvedFixture(),
    id = await enqueueOutbox(
      rpc,
      fixture.packageId,
      new Date(Date.now() - 1000).toISOString(),
      true,
    ),
    state = await readControl(rpc, true),
    account = state.entities.find((e) => e.id === fixture.accountId)!;
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        ...account,
        version: account.version + 1,
        data: { ...account.data, delivery_transport: "native" },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "fixture-transport-change",
  });
  const send = vi.fn<Transport>();
  await processOutbox(rpc, true, send);
  expect(await outbox(String(id))).toMatchObject({
    status: "blocked",
    error: "IMMUTABLE_ADAPTER_MISMATCH",
  });
  expect(send).not.toHaveBeenCalled();
});

it.each(["expired", "revised"] as const)(
  "records an accepted Buffer post after approval is %s without changing current content or writing to the provider",
  async (change) => {
    const fixture = await approvedFixture(),
      provider = bufferFixture();
    const id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
      ),
    );
    await processOutbox(rpc, true, provider.send);
    const accepted = await outbox(id);
    if (change === "revised") {
      await run({
        action: "content_transition",
        id: fixture.package.parent_id,
        target: "drafting",
        confirmed: true,
      });
    } else {
      const state = await readControl(rpc, true),
        content = state.entities.find(
          (e) => e.id === fixture.package.parent_id,
        )!;
      await rpc("commit_control", {
        p_epoch: state.epoch,
        p_entities: [
          {
            ...content,
            version: content.version + 1,
            data: {
              ...content.data,
              evergreen: false,
              fresh_until: new Date(Date.now() - 1000).toISOString(),
            },
          },
        ],
        p_jobs: [],
        p_public: [],
        p_actor: "Daniel demo",
      });
    }
    const state = await readControl(rpc, true),
      account = state.entities.find((e) => e.id === fixture.accountId)!;
    await rpc("commit_control", {
      p_epoch: state.epoch,
      p_entities: [
        {
          ...account,
          version: account.version + 1,
          data: { ...account.data, capabilities: ["profile_read"] },
        },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "fixture-revoked-publish-capability",
    });
    const before = await readControl(rpc, true),
      currentContent = before.entities.find(
        (e) => e.id === fixture.package.parent_id,
      )!;
    if (change === "revised")
      expect(
        before.entities.find((e) => e.id === fixture.packageId)!.version,
      ).toBeGreaterThan(fixture.package.version);
    vi.stubEnv("BRAINOS_EXTERNAL_PUBLISHING", "disabled");
    provider.markSent();
    await dueNow(id);
    const recordedRpc = vi.fn<Rpc>((name, args) => rpc(name, args));
    await processOutbox(recordedRpc, true, provider.send);
    expect(await outbox(id)).toMatchObject({
      status: "published",
      remote: { id: postId },
    });
    expect(
      provider.calls.filter((call) => call.query.startsWith("mutation")),
    ).toHaveLength(1);
    expect(
      provider.calls.some((call) => call.query.includes("query BufferPost(")),
    ).toBe(true);
    expect(
      recordedRpc.mock.calls.some(
        ([name]) => name === "attach_publication_url",
      ),
    ).toBe(false);
    const after = await readControl(rpc, true),
      publication = after.entities.find((e) => e.kind === "publication")!;
    expect(after.entities.find((e) => e.id === currentContent.id)).toEqual(
      currentContent,
    );
    expect(publication).toMatchObject({
      story_id: fixture.package.story_id,
      draft_id: fixture.package.draft_id,
      parent_id: fixture.package.parent_id,
    });
    expect(publication.data).toMatchObject({
      package_id: fixture.packageId,
      package_version: fixture.package.version,
      approval_current_at_receipt: false,
      external_id: postId,
      account_external_id: channelId,
      adapter_id: "buffer",
      published_at: provider.publishedAt,
      content_dimensions: (
        accepted.payload.publication_provenance as {
          content_dimensions: unknown;
        }
      ).content_dimensions,
    });
    const jobs = after.jobs.filter(
      (job) => job.kind === "analytics" && job.entity_id === publication.id,
    );
    expect(
      jobs.map((job) => job.input.hours).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([24, 72, 168]);
    for (const job of jobs)
      expect(Date.parse(job.due_at) - Date.parse(provider.publishedAt)).toBe(
        Number(job.input.hours) * 3600000,
      );
    const first = jobs.find((job) => job.input.hours === 24)!;
    await db.query(
      "update control_jobs set due_at=now()-interval '1 minute' where id=$1",
      [first.id],
    );
    const claimed = (await rpc("claim_control_job", {
      p_kind: "analytics",
      p_demo: true,
    })) as Job;
    await captureAnalytics(rpc, claimed, true, provider.send);
    expect(
      (await readControl(rpc, true)).entities.find(
        (e) => e.id === publication.id,
      )?.data.metrics,
    ).toHaveLength(1);
    expect(
      provider.calls.filter((call) => call.query.startsWith("mutation")),
    ).toHaveLength(1);
  },
);

it("reads a ready Instagram container after approval changes without publishing it", async () => {
  const fixture = await approvedFixture("native", [], "instagram"),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
      ),
    );
  await db.query(
    "update provider_outbox set status='processing',remote=$2::jsonb where id=$1",
    [id, JSON.stringify({ id: "fixture-ig-container", status: "processing" })],
  );
  await run({
    action: "content_transition",
    id: fixture.package.parent_id,
    target: "drafting",
    confirmed: true,
  });
  const send = vi.fn<Transport>(async (url, init) => {
    expect(String(url)).toContain(
      "/fixture-ig-container?fields=status_code,status",
    );
    expect(init?.method ?? "GET").toBe("GET");
    return json({ status_code: "FINISHED" });
  });
  await processOutbox(rpc, true, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await outbox(id)).toMatchObject({
    status: "blocked",
    remote: { id: "fixture-ig-container", status: "container_ready" },
  });
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) => e.kind === "publication",
    ),
  ).toHaveLength(0);
});

it("keeps a future schedule local until due, then submits shareNow with its immutable approval intact", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    scheduledAt = new Date(Date.now() + 3 * 3600000).toISOString(),
    id = await enqueueOutbox(
      rpc,
      fixture.packageId,
      new Date(Date.now() - 1000).toISOString(),
      true,
      { mode: "schedule", scheduled_at: scheduledAt },
    );
  await processOutbox(rpc, true, provider.send);
  expect(provider.send).not.toHaveBeenCalled();
  const queued = await outbox(String(id));
  expect(queued.status).toBe("queued");
  expect(Date.parse(queued.due_at)).toBe(Date.parse(scheduledAt));
  expect(queued.payload.delivery).toEqual({
    mode: "schedule",
    scheduled_at: scheduledAt,
  });
  await rpc("recover_provider_outbox", {
    p_id: id,
    p_action: "retry",
    p_actor: "fixture-human",
    p_demo: true,
  });
  await processOutbox(rpc, true, provider.send);
  expect(provider.send).not.toHaveBeenCalled();
  expect(Date.parse((await outbox(String(id))).due_at)).toBe(
    Date.parse(scheduledAt),
  );
  await advanceSchedule(String(id), scheduledAt);
  await processOutbox(rpc, true, provider.send);
  const mutation = provider.calls.find((call) =>
    call.query.includes("mutation BufferCreatePost("),
  );
  expect(mutation?.variables.input).toMatchObject({
    mode: "shareNow",
    saveToDraft: false,
  });
  expect(mutation?.variables.input).not.toHaveProperty("dueAt");
  const scheduled = await outbox(String(id));
  expect(scheduled).toMatchObject({
    status: "processing",
    remote: { id: postId, status: "scheduled" },
  });
  expect(scheduled.payload).toEqual(queued.payload);
  const count = provider.send.mock.calls.length;
  await processOutbox(rpc, true, provider.send);
  expect(provider.send).toHaveBeenCalledTimes(count);
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) => e.kind === "publication",
    ),
  ).toHaveLength(0);
});

it("rechecks revoked approval at the local due time before any Buffer request", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    scheduledAt = new Date(Date.now() + 3 * 3600000).toISOString(),
    id = await enqueueOutbox(
      rpc,
      fixture.packageId,
      new Date().toISOString(),
      true,
      { mode: "schedule", scheduled_at: scheduledAt },
    );
  await run({
    action: "content_transition",
    id: fixture.package.parent_id,
    target: "drafting",
    confirmed: true,
  });
  await advanceSchedule(String(id), scheduledAt);
  await processOutbox(rpc, true, provider.send);
  expect((await outbox(String(id))).status).toBe("blocked");
  expect(provider.send).not.toHaveBeenCalled();
});

it("does not duplicate a Buffer create after an ambiguous write or reconciliation without a remote ID", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    id = await enqueueOutbox(
      rpc,
      fixture.packageId,
      new Date(Date.now() - 1000).toISOString(),
      true,
    );
  let mutations = 0;
  const send = vi.fn<Transport>(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as GraphRequest;
    if (body.query.includes("mutation BufferCreatePost(")) {
      mutations++;
      throw Error("Fixture connection ended before response");
    }
    return provider.send(url, init);
  });
  await processOutbox(rpc, true, send);
  expect(await outbox(String(id))).toMatchObject({
    status: "uncertain",
    error: "NETWORK_FAILURE",
    remote: { status: "dispatching", transport: "buffer" },
  });
  await expect(
    rpc("recover_provider_outbox", {
      p_id: id,
      p_action: "retry",
      p_actor: "fixture",
      p_demo: true,
    }),
  ).rejects.toThrow("reconcile");
  await rpc("recover_provider_outbox", {
    p_id: id,
    p_action: "reconcile",
    p_actor: "fixture",
    p_demo: true,
  });
  await processOutbox(rpc, true, send);
  expect((await outbox(String(id))).status).toBe("uncertain");
  expect(mutations).toBe(1);
  expect(send).toHaveBeenCalledTimes(2);
});

it("blocks a missing credential without contacting Buffer", async () => {
  const fixture = await approvedFixture(),
    id = await enqueueOutbox(
      rpc,
      fixture.packageId,
      new Date(Date.now() - 1000).toISOString(),
      true,
    );
  await rpc("provider_secret", { p_id: fixture.accountId, p_delete: true });
  const send = vi.fn<Transport>();
  await processOutbox(rpc, true, send);
  expect(await outbox(String(id))).toMatchObject({
    status: "blocked",
    error: "AUTH_REQUIRED",
  });
  expect(send).not.toHaveBeenCalled();
});

it("releases an existing Buffer draft with its same remote ID and one create mutation", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
        { mode: "draft" },
      ),
    );
  await processOutbox(rpc, true, provider.send);
  const draft = await outbox(id);
  expect(draft).toMatchObject({
    status: "draft",
    remote: { id: postId, status: "draft" },
  });
  await processOutbox(rpc, true, provider.send);
  expect(
    provider.calls.filter((call) =>
      call.query.includes("mutation BufferCreatePost("),
    ),
  ).toHaveLength(1);
  await manageDistribution(
    rpc,
    id,
    true,
    "fixture-human",
    "release",
    { mode: "now" },
    provider.send,
  );
  expect(await outbox(id)).toMatchObject({
    status: "processing",
    remote: {
      id: postId,
      status: "scheduled",
      management_authorization: {
        actor: "fixture-human",
        operation: "release",
        delivery: { mode: "now" },
      },
    },
  });
  expect((await outbox(id)).payload).toEqual(draft.payload);
  expect(
    provider.calls.filter((call) =>
      call.query.includes("mutation BufferEditPost("),
    ),
  ).toHaveLength(1);
  expect(
    provider.calls.find((call) =>
      call.query.includes("mutation BufferEditPost("),
    )?.variables.input,
  ).toMatchObject({ id: postId, mode: "shareNow", saveToDraft: false });
  provider.markSent();
  await dueNow(id);
  await processOutbox(rpc, true, provider.send);
  expect((await outbox(id)).status).toBe("published");
  expect(
    provider.calls.filter((call) =>
      call.query.includes("mutation BufferCreatePost("),
    ),
  ).toHaveLength(1);
  expect(
    (await readControl(rpc, true)).entities.find(
      (e) => e.kind === "publication",
    )?.data.external_id,
  ).toBe(postId);
});

it("holds an authorized future draft release locally and edits the same remote post only when due", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
        { mode: "draft" },
      ),
    );
  await processOutbox(rpc, true, provider.send);
  const initialCalls = provider.send.mock.calls.length,
    scheduledAt = new Date(Date.now() + 3 * 3600000).toISOString(),
    delivery = { mode: "schedule" as const, scheduled_at: scheduledAt };
  await manageDistribution(
    rpc,
    id,
    true,
    "fixture-human",
    "release",
    delivery,
    provider.send,
  );
  expect(provider.send).toHaveBeenCalledTimes(initialCalls);
  const queued = await outbox(id);
  expect(queued).toMatchObject({
    status: "queued",
    remote: {
      id: postId,
      status: "draft",
      release_authorization: { actor: "fixture-human", delivery },
    },
  });
  expect(Date.parse(queued.due_at)).toBe(Date.parse(scheduledAt));
  await processOutbox(rpc, true, provider.send);
  expect(provider.send).toHaveBeenCalledTimes(initialCalls);
  await rpc("recover_provider_outbox", {
    p_id: id,
    p_action: "retry",
    p_actor: "fixture-human",
    p_demo: true,
  });
  await processOutbox(rpc, true, provider.send);
  expect(provider.send).toHaveBeenCalledTimes(initialCalls);
  expect(Date.parse((await outbox(id)).due_at)).toBe(Date.parse(scheduledAt));
  await advanceSchedule(id, scheduledAt);
  await processOutbox(rpc, true, provider.send);
  expect(await outbox(id)).toMatchObject({
    status: "processing",
    remote: { id: postId, status: "scheduled" },
  });
  expect(
    provider.calls.filter((call) =>
      call.query.includes("mutation BufferCreatePost("),
    ),
  ).toHaveLength(1);
  const edits = provider.calls.filter((call) =>
    call.query.includes("mutation BufferEditPost("),
  );
  expect(edits).toHaveLength(1);
  expect(edits[0].variables.input).toMatchObject({
    id: postId,
    mode: "shareNow",
    saveToDraft: false,
  });
  expect(edits[0].variables.input).not.toHaveProperty("dueAt");
  expect((await outbox(id)).payload).toEqual(queued.payload);
});

it("cancels an unsent Buffer post only after provider confirmation and excludes concurrent management", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
      ),
    );
  await processOutbox(rpc, true, provider.send);
  const send = vi.fn<Transport>(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as GraphRequest;
    if (body.query.includes("mutation BufferDeletePost(")) {
      expect((await outbox(id)).status).toBe("cancelling");
      await expect(
        manageDistribution(
          rpc,
          id,
          true,
          "other-fixture",
          "cancel",
          undefined,
          provider.send,
        ),
      ).rejects.toThrow("busy");
      expect(await rpc("claim_provider_outbox", { p_demo: true })).toBeNull();
    }
    return provider.send(url, init);
  });
  await manageDistribution(
    rpc,
    id,
    true,
    "fixture-human",
    "cancel",
    undefined,
    send,
  );
  expect(await outbox(id)).toMatchObject({
    status: "cancelled",
    remote: {
      id: postId,
      status: "cancelled",
      management_authorization: { operation: "cancel" },
    },
  });
  await expect(
    manageDistribution(
      rpc,
      id,
      true,
      "fixture-human",
      "cancel",
      undefined,
      send,
    ),
  ).rejects.toThrow("unavailable");
  expect(
    provider.calls.filter((call) =>
      call.query.includes("mutation BufferDeletePost("),
    ),
  ).toHaveLength(1);
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) => e.kind === "publication",
    ),
  ).toHaveLength(0);
});

it("does not release an existing scheduled Buffer draft after its approval is revoked", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
        { mode: "draft" },
      ),
    );
  await processOutbox(rpc, true, provider.send);
  const scheduledAt = new Date(Date.now() + 3 * 3600000).toISOString();
  await manageDistribution(
    rpc,
    id,
    true,
    "fixture-human",
    "release",
    { mode: "schedule", scheduled_at: scheduledAt },
    provider.send,
  );
  await run({
    action: "content_transition",
    id: fixture.package.parent_id,
    target: "drafting",
    confirmed: true,
  });
  await advanceSchedule(id, scheduledAt);
  await processOutbox(rpc, true, provider.send);
  expect(await outbox(id)).toMatchObject({
    status: "blocked",
    remote: { id: postId, status: "draft" },
  });
  expect(
    provider.calls.filter((call) => call.query.startsWith("mutation")),
  ).toHaveLength(1);
  expect(
    provider.calls.some((call) =>
      call.query.includes("mutation BufferEditPost("),
    ),
  ).toBe(false);
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) => e.kind === "publication",
    ),
  ).toHaveLength(0);
});

it("rejects a Buffer video with a separate graphic before generating media URLs or contacting a provider", async () => {
  const fixture = await approvedFixture(),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
      ),
    ),
    row = await outbox(id),
    noRpc = vi.fn<Rpc>(),
    send = vi.fn<Transport>();
  const withCover = {
    ...row,
    payload: {
      ...row.payload,
      media_ref: {
        provider: "supabase",
        file_id: "fixture-video",
        sha256: "fixture-checksum",
      },
      graphic_refs: [{ id: "fixture-cover", version: 1 }],
    },
  } as unknown as Outbox;
  await expect(dispatchInputs(noRpc, withCover, send)).rejects.toMatchObject({
    code: "BUFFER_CUSTOM_VIDEO_COVER_UNSUPPORTED",
  });
  expect(noRpc).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("keeps an ambiguous Buffer delete uncertain until provider lookup proves deletion", async () => {
  const fixture = await approvedFixture(),
    provider = bufferFixture(),
    id = String(
      await enqueueOutbox(
        rpc,
        fixture.packageId,
        new Date(Date.now() - 1000).toISOString(),
        true,
      ),
    );
  await processOutbox(rpc, true, provider.send);
  let deleteAttempts = 0;
  const send = vi.fn<Transport>(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as GraphRequest;
    if (body.query.includes("mutation BufferDeletePost(")) {
      deleteAttempts++;
      throw Error("Fixture delete response lost");
    }
    return provider.send(url, init);
  });
  await expect(
    manageDistribution(
      rpc,
      id,
      true,
      "fixture-human",
      "cancel",
      undefined,
      send,
    ),
  ).rejects.toMatchObject({ code: "NETWORK_FAILURE", uncertain: true });
  expect(await outbox(id)).toMatchObject({
    status: "uncertain",
    remote: { status: "cancelling", buffer_cancel_requested: true },
  });
  await expect(
    rpc("recover_provider_outbox", {
      p_id: id,
      p_action: "cancel",
      p_actor: "fixture-human",
      p_demo: true,
    }),
  ).rejects.toThrow("Remote cancellation must be confirmed");
  await expect(
    manageDistribution(
      rpc,
      id,
      true,
      "fixture-human",
      "cancel",
      undefined,
      send,
    ),
  ).rejects.toMatchObject({ uncertain: true });
  expect((await outbox(id)).status).toBe("uncertain");
  expect(deleteAttempts).toBe(1);
  provider.markDeleted();
  await manageDistribution(
    rpc,
    id,
    true,
    "fixture-human",
    "cancel",
    undefined,
    send,
  );
  expect((await outbox(id)).status).toBe("cancelled");
  expect(deleteAttempts).toBe(1);
});

it("resumes a native X thread after definite HTTP 429 without reposting completed tweets", async () => {
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
  const fixture = await approvedFixture("native", [
      "DEMO first post",
      "DEMO second post",
    ]),
    id = await enqueueOutbox(
      rpc,
      fixture.packageId,
      new Date(Date.now() - 1000).toISOString(),
      true,
    ),
    attempted: string[] = [],
    published: string[] = [];
  const send = vi.fn<Transport>(async (url, init) => {
    expect(url).toBe("https://api.x.com/2/tweets");
    const body = JSON.parse(String(init?.body));
    attempted.push(body.text);
    if (attempted.length === 2) return json({}, 429);
    if (published.length)
      expect(body.reply.in_reply_to_tweet_id).toBe(
        `fixture-tweet-${published.length}`,
      );
    published.push(body.text);
    return json({ data: { id: `fixture-tweet-${published.length}` } });
  });
  await processOutbox(rpc, true, send);
  expect(await outbox(String(id))).toMatchObject({
    status: "queued",
    error: "RATE_LIMIT",
    remote: { status: "processing", ids: ["fixture-tweet-1"] },
  });
  await dueNow(String(id));
  await processOutbox(rpc, true, send);
  expect((await outbox(String(id))).status).toBe("published");
  expect(published).toEqual(fixture.package.data.thread);
  expect(
    attempted.filter((text) => text === fixture.package.data.thread[0]),
  ).toHaveLength(1);
  expect(attempted).toHaveLength(published.length + 1);
  expect(
    (await readControl(rpc, true)).entities.filter(
      (e) =>
        e.kind === "publication" && e.data.package_id === fixture.packageId,
    ),
  ).toHaveLength(1);
});
