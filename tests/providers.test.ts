import { afterAll, beforeAll, afterEach, it, expect, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  controlAction,
  controlSnapshot,
  readControl,
  processJobs,
} from "../src/control/service";
import {
  OfficialClient,
  type Payload,
  type TokenSet,
} from "../src/providers/client";
import {
  startProviderAuth,
  finishProviderAuth,
  selectProviderAccount,
  providerToken,
} from "../src/providers/auth";
import {
  payloadChecksum,
  enqueueOutbox,
  processOutbox,
} from "../src/providers/outbox";
import { activationAction, profileDrift } from "../src/providers/activation";
import { expectedWindow, schedulerHealth } from "../src/operations/automation";
import { platforms } from "../src/control/model";
import { rasterize } from "../src/providers/raster";
import { submitOpportunity } from "../src/control/opportunities";
const token: TokenSet = {
  access_token: "fixture-token-NOT-REAL",
  expires_at: Date.now() + 3600000,
  scopes: [],
};
const json = (v: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
afterEach(() => vi.unstubAllEnvs());
for (const p of platforms) {
  it(`${p}: missing credential blocks without HTTP`, async () => {
    const send = vi.fn();
    const c = new OfficialClient(p, { ...token, access_token: "" }, send);
    await expect(c.request("/fixture")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(send).not.toHaveBeenCalled();
  });
  it(`${p}: expired credential blocks`, async () => {
    vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
    const send = vi.fn();
    await expect(
      new OfficialClient(p, { ...token, expires_at: 0 }, send).request(
        "/fixture",
      ),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(send).not.toHaveBeenCalled();
  });
  it(`${p}: rate limit normalizes without secret leakage or automatic writes`, async () => {
    vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
    const send = vi.fn(async () =>
      json(
        {
          error: {
            code: "rate_limit_exceeded",
            message: "secret fixture-token-NOT-REAL",
          },
        },
        429,
        { "retry-after": "120" },
      ),
    );
    try {
      await new OfficialClient(p, token, send).request("/fixture");
      throw Error("Expected error");
    } catch (e) {
      expect(e).toMatchObject({
        code: "RATE_LIMIT",
        retryable: true,
        retryAfter: 120,
      });
      expect(String(e)).not.toContain(token.access_token);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });
  it(`${p}: permanent scope failure is explicit`, async () => {
    vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
    await expect(
      new OfficialClient(p, token, async () => json({}, 403)).request(
        "/fixture",
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE", retryable: false });
  });
  it(`${p}: mutation timeout is uncertain, never blindly retryable`, async () => {
    vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
    await expect(
      new OfficialClient(p, token, async () => {
        throw Error("timeout token fixture-token-NOT-REAL");
      }).request("/fixture", "POST", {}),
    ).rejects.toMatchObject({
      code: "NETWORK_FAILURE",
      uncertain: true,
      retryable: false,
    });
  });
  it(`${p}: live publishing remains disabled`, async () => {
    const send = vi.fn();
    await expect(
      new OfficialClient(p, token, send).publish("fixture", {
        title: "demo",
        caption: "demo",
        thread: [],
        source_links: [],
        media_urls: [],
      }),
    ).rejects.toMatchObject({ code: "EXTERNAL_PUBLISHING_DISABLED" });
    expect(send).not.toHaveBeenCalled();
  });
}
it("X blocks paid reads with no network call", async () => {
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "false");
  const send = vi.fn();
  await expect(
    new OfficialClient("x", token, send).discover(),
  ).rejects.toMatchObject({ code: "PAID_API_ACCESS_REQUIRED" });
  expect(send).not.toHaveBeenCalled();
});
it("manual success cannot prove a scheduled window", () => {
  const now = Date.parse("2026-10-02T12:30:00Z"),
    manual = {
      lane: "discovery" as const,
      event: "manual",
      window_at: "2026-10-02T11:30:00Z",
      status: "success",
      started_at: "2026-10-02T11:30:00Z",
      finished_at: "2026-10-02T11:31:00Z",
    };
  expect(schedulerHealth([manual], now).discovery.state).toBe("missed");
  expect(expectedWindow("discovery", Date.parse("2026-10-02T10:00:00Z"))).toBe(
    "2026-10-01T11:30:00.000Z",
  );
});
it("scheduler records failures and hourly missed window", () => {
  const now = Date.parse("2026-10-02T12:40:00Z");
  expect(schedulerHealth([], now).operations.state).toBe("missed");
  expect(
    schedulerHealth(
      [
        {
          lane: "operations",
          event: "schedule",
          window_at: "2026-10-02T12:17:00Z",
          status: "failed",
          started_at: "2026-10-02T12:17:00Z",
          finished_at: "2026-10-02T12:18:00Z",
        },
      ],
      now,
    ).operations.state,
  ).toBe("failed");
});
it("payload checksum is stable across JSONB key ordering", () =>
  expect(payloadChecksum({ z: 1, a: { y: 2, b: 3 } })).toBe(
    payloadChecksum({ a: { b: 3, y: 2 }, z: 1 }),
  ));
it("profile drift never overwrites a remote profile", () => {
  expect(
    profileDrift(
      { name: "Daniel", handle: "desired", bio: "AI" },
      { name: "Daniel", handle: "different", bio: "AI" },
    ),
  ).toEqual({ status: "DRIFT", fields: ["handle"] });
  expect(profileDrift({})).toEqual({ status: "UNKNOWN", fields: [] });
});
it("rasterizer produces real PNG dimensions and rejects remote image sources", async () => {
  const r = await rasterize(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#fff"/></svg>',
  );
  expect(r.bytes.subarray(1, 4).toString()).toBe("PNG");
  expect([r.width, r.height]).toEqual([1080, 1350]);
  await expect(
    rasterize('<svg><image href="http://localhost/private"/></svg>'),
  ).rejects.toThrow("Unsafe");
});
it("Instagram persists container/publish IDs and checks status", async () => {
  const calls: string[] = [],
    saved: unknown[] = [],
    responses = [
      { id: "container-fixture" },
      { status_code: "FINISHED" },
      { id: "media-fixture" },
      {
        id: "media-fixture",
        permalink: "https://www.instagram.com/p/fixture/",
      },
    ];
  const client = new OfficialClient(
    "instagram",
    token,
    async (u) => {
      calls.push(u);
      return json(responses.shift());
    },
    true,
  );
  const r = await client.publish(
    "creator-fixture",
    {
      title: "demo",
      caption: "demo",
      thread: [],
      source_links: [],
      media_urls: ["https://example.invalid/demo.png"],
    },
    {},
    async (v) => {
      saved.push(v);
    },
  );
  expect(r.id).toBe("media-fixture");
  expect(saved).toContainEqual({ id: "media-fixture", status: "published" });
  expect(calls[1]).toContain("status_code");
});
it("TikTok honors creator-specific duration/privacy and response errors", async () => {
  const c = new OfficialClient(
    "tiktok",
    token,
    async () =>
      json({
        data: {
          privacy_level_options: ["SELF_ONLY"],
          max_video_post_duration_sec: 60,
        },
        error: { code: "ok", message: "", log_id: "fixture" },
      }),
    true,
  );
  await expect(
    c.publish("creator", {
      title: "demo",
      caption: "demo",
      thread: [],
      source_links: [],
      media_urls: [],
      media: {
        url: "https://demo.supabase.co/demo.mp4",
        mime: "video/mp4",
        bytes: 100,
        duration: 10,
        width: 720,
        height: 1280,
        codec: "h264",
        sha256: "fixture",
      },
    }),
  ).rejects.toMatchObject({ code: "CREATOR_PRIVACY_CHOICE_REQUIRED" });
});
it("YouTube establishes a durable resumable session and resumes binary upload", async () => {
  const saves: unknown[] = [],
    responses = [
      new Response(null, {
        status: 200,
        headers: {
          location:
            "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture",
        },
      }),
      new Response(null, { status: 308 }),
      new Response(new Uint8Array([1, 2, 3])),
      json({ id: "video-fixture" }),
    ],
    calls: RequestInit[] = [];
  const c = new OfficialClient(
    "youtube",
    token,
    async (_u, init) => {
      calls.push(init!);
      return responses.shift()!;
    },
    true,
  );
  const p: Payload = {
    title: "DEMO",
    caption: "DEMO",
    thread: [],
    source_links: [],
    media_urls: [],
    media: {
      url: "https://demo.supabase.co/storage/demo",
      bytes: 3,
      mime: "video/mp4",
      width: 720,
      height: 1280,
      codec: "h264",
      duration: 1,
      sha256: "x",
    },
  };
  expect(
    (
      await c.publish("channel", p, {}, async (r) => {
        saves.push(r);
      })
    ).id,
  ).toBe("video-fixture");
  expect(saves[0]).toMatchObject({ status: "upload_pending" });
  expect(calls.at(-1)?.headers).toMatchObject({
    "Content-Range": "bytes 0-2/3",
  });
});
it("X thread checkpoints every completed post and preserves uncertain partial failure", async () => {
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
  let n = 0;
  const saved: unknown[] = [];
  const c = new OfficialClient(
    "x",
    token,
    async () => {
      if (n++ === 0) return json({ data: { id: "first-fixture" } });
      throw Error("lost response");
    },
    true,
  );
  await expect(
    c.publish(
      "user",
      {
        title: "demo",
        caption: "demo",
        thread: ["one", "two"],
        source_links: [],
        media_urls: [],
      },
      {},
      async (r) => {
        saved.push(r);
      },
    ),
  ).rejects.toMatchObject({ uncertain: true });
  expect(saved).toContainEqual({
    ids: ["first-fixture"],
    next_index: 1,
    status: "processing",
  });
});
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
  const b = await controlAction(
    rpc,
    {
      action: "brand_save",
      name: "DEMO",
      positioning: "DEMO applied AI",
      audience: "Operators",
      pillars: ["AI at work"],
      tone: ["Specific"],
      cta: "Inspect evidence",
    },
    "Daniel demo",
    true,
  );
  await controlAction(
    rpc,
    { action: "brand_approve", id: b.id, confirmed: true },
    "Daniel demo",
    true,
  );
}, 30000);
afterAll(async () => db.close());
async function approvedPackage() {
  const snap = await controlSnapshot(rpc, true),
    s = snap.stories.find((s) => s.status === "approved")!;
  const run = (c: unknown) => controlAction(rpc, c, "Daniel demo", true);
  const i = await run({
    action: "idea_create",
    title: "DEMO simulation",
    source: "story",
    story_id: s.id,
    provenance: "Fictional fixture only",
  });
  await run({ action: "idea_transition", id: i.id, target: "qualified" });
  await run({ action: "idea_transition", id: i.id, target: "selected" });
  const c = await run({
    action: "content_create",
    idea_id: i.id,
    platform: "x",
    format: "post",
    purpose: "Demo",
  });
  await run({ action: "content_bind", id: c.id, draft_id: s.active_draft_id });
  await run({
    action: "content_freshness",
    id: c.id,
    evergreen: true,
    fresh_until: null,
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id: c.id,
    target: "review",
    confirmed: true,
  });
  await run({
    action: "content_transition",
    id: c.id,
    target: "approved",
    confirmed: true,
  });
  const p = await run({
    action: "package_create",
    id: c.id,
    title: "DEMO",
    caption: "Demo verified workflow",
    cta: "Inspect",
    thread: [],
    graphic_ids: [],
  });
  await run({ action: "package_approve", id: p.id, confirmed: true });
  await run({
    action: "content_final",
    id: c.id,
    package_id: p.id,
    confirmed: true,
  });
  await run({ action: "account_create", platform: "x", handle: "demo" });
  const state = await readControl(rpc, true),
    a = state.entities.find(
      (e) => e.kind === "account" && e.data.platform === "x",
    )!;
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        ...a,
        version: a.version + 1,
        data: {
          ...a.data,
          status: "connected",
          external_id: "demo-only",
          capabilities: ["publish", "analytics"],
          simulation: "success",
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "fixture",
  });
  return p.id!;
}
it("real outbox simulator path publishes once and schedules exact analytics windows", async () => {
  const id = await approvedPackage(),
    due = new Date(Date.now() - 1000).toISOString();
  const a = await enqueueOutbox(rpc, id, due, true),
    b = await enqueueOutbox(rpc, id, due, true);
  expect(a).toBe(b);
  await processOutbox(rpc, true);
  await processOutbox(rpc, true);
  const state = await readControl(rpc, true),
    pubs = state.entities.filter(
      (e) => e.kind === "publication" && e.data.package_id === id,
    );
  expect(pubs).toHaveLength(1);
  expect(pubs[0].data.simulated).toBe(true);
  const jobs = state.jobs.filter((j) => j.entity_id === pubs[0].id);
  expect(jobs).toHaveLength(3);
  for (const j of jobs)
    expect(
      Date.parse(j.due_at) - Date.parse(String(pubs[0].data.published_at)),
    ).toBe(Number(j.input.hours) * 3600000);
  await db.exec(
    "update control_jobs set due_at=now()-interval '1 minute' where kind='analytics'",
  );
  await processJobs(rpc, "analytics", true);
  const after = await readControl(rpc, true),
    pub = after.entities.find((e) => e.id === pubs[0].id)!;
  expect(pub.data.metrics).toHaveLength(3);
  expect(
    (
      pub.data.metrics as { synthetic: boolean; lateness_seconds: number }[]
    ).every((m) => m.synthetic && m.lateness_seconds >= 60),
  ).toBe(true);
}, 30000);
it("automation claim is idempotent and manual runs stay separate", async () => {
  const args = {
    p_lane: "discovery",
    p_window: "2026-10-02T11:30:00Z",
    p_event: "schedule",
  };
  expect(await rpc("claim_automation", args)).toBeTruthy();
  expect(await rpc("claim_automation", args)).toBeNull();
  expect(
    await rpc("claim_automation", { ...args, p_event: "manual" }),
  ).toBeTruthy();
});
it("OAuth is cookie-bound, one-use, encrypted and account selection fails closed", async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("CONTENT_OS_ORIGIN", "https://example.invalid");
  vi.stubEnv("YOUTUBE_CLIENT_ID", "fixture-client");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "fixture-secret");
  await controlAction(
    rpc,
    { action: "account_create", platform: "youtube", handle: "demo" },
    "Daniel demo",
    false,
  );
  const a = (await readControl(rpc, false)).entities.find(
    (e) => e.kind === "account" && e.data.platform === "youtube",
  )!;
  const consent = await startProviderAuth(rpc, "youtube", "actor", a.id),
    state = new URL(consent.url).searchParams.get("state")!,
    send = vi.fn(async (u) =>
      u.includes("token")
        ? json({
            access_token: "fixture-grant",
            refresh_token: "fixture-refresh",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/youtube.readonly",
          })
        : json({
            items: [
              {
                id: "channel-fixture",
                snippet: {
                  title: "DEMO",
                  description: "DEMO",
                  customUrl: "@demo",
                },
              },
            ],
          }),
    );
  await expect(
    finishProviderAuth(
      rpc,
      "youtube",
      "other",
      consent.cookie,
      state,
      "fixture-code",
      send,
    ),
  ).rejects.toMatchObject({ code: "OAUTH_COOKIE_MISMATCH" });
  await finishProviderAuth(
    rpc,
    "youtube",
    "actor",
    consent.cookie,
    state,
    "fixture-code",
    send,
  );
  await expect(
    finishProviderAuth(
      rpc,
      "youtube",
      "actor",
      consent.cookie,
      state,
      "fixture-code",
      send,
    ),
  ).rejects.toThrow("replayed");
  await expect(
    selectProviderAccount(rpc, a.id, "different", "actor", send),
  ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  expect((await providerToken(rpc, a.id, send)).access_token).toBe(
    "fixture-grant",
  );
  expect(JSON.stringify(await readControl(rpc, false))).not.toContain(
    "fixture-grant",
  );
}, 30000);
it("profile generation requires active brand/handle and approval is exact", async () => {
  await activationAction(
    rpc,
    { action: "handle", name: "demoonly", fallbacks: [], available: false },
    "Daniel demo",
    true,
  );
  await activationAction(
    rpc,
    { action: "profile_generate", provider: "instagram" },
    "Daniel demo",
    true,
  );
  let p = (await readControl(rpc, true)).entities.find(
    (e) => e.kind === "profile",
  )!;
  expect(p.data.status).toBe("draft");
  await activationAction(
    rpc,
    { action: "profile_approve", id: p.id, confirmed: true },
    "Daniel demo",
    true,
  );
  p = (await readControl(rpc, true)).entities.find((e) => e.id === p.id)!;
  expect(p.data.status).toBe("approved");
  await expect(
    activationAction(
      rpc,
      {
        action: "profile_save",
        id: p.id,
        name: "demo",
        handle: "demo",
        bio: "changed",
        link: "https://example.invalid",
        category: "AI",
      },
      "Daniel demo",
      true,
    ),
  ).rejects.toThrow("new profile revision");
});

it("public opportunity consent, spam limits and PII separation", async () => {
  const data = {
    kind: "consulting",
    name: "DEMO Person",
    email: "demo-intake@example.invalid",
    details: "DEMO consulting request",
    consent: true,
  };
  await expect(
    submitOpportunity(rpc, { ...data, consent: false }, "demo-ip"),
  ).rejects.toThrow();
  await expect(
    submitOpportunity(rpc, { ...data, website: "spam" }, "demo-ip"),
  ).rejects.toThrow("Unable");
  for (let i = 0; i < 5; i++) await submitOpportunity(rpc, data, "demo-ip");
  await expect(submitOpportunity(rpc, data, "demo-ip")).rejects.toThrow(
    "retry later",
  );
  expect(JSON.stringify(await rpc("read_public_surface"))).not.toContain(
    data.email,
  );
  expect(JSON.stringify(await readControl(rpc, true))).not.toContain(
    data.email,
  );
  const permission = await db.query<{ allowed: boolean }>(
    "select has_table_privilege('anon','opportunity_intake','select') allowed",
  );
  expect(permission.rows[0].allowed).toBe(false);
  await rpc("delete_intake_data", {
    p_email: data.email,
    p_actor: "verified demo admin",
  });
  expect(JSON.stringify(await rpc("read_opportunities"))).not.toContain(
    data.email,
  );
});
for (const mode of [
  "delayed",
  "transient",
  "rate_limit",
  "permanent",
  "partial_thread",
] as const) {
  it(`outbox simulator ${mode} preserves safe recovery`, async () => {
    const id = await approvedPackage(),
      s = await readControl(rpc, true),
      a = s.entities.find(
        (e) => e.kind === "account" && e.data.platform === "x",
      )!;
    await rpc("commit_control", {
      p_epoch: s.epoch,
      p_entities: [
        { ...a, version: a.version + 1, data: { ...a.data, simulation: mode } },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "fixture",
    });
    const oid = await enqueueOutbox(
      rpc,
      id,
      new Date(Date.now() - 1000).toISOString(),
      true,
    );
    await processOutbox(rpc, true);
    let rows = (await rpc("read_provider_outbox", { p_demo: true })) as {
      id: string;
      status: string;
      remote: Record<string, unknown>;
    }[];
    const first = rows.find((r) => r.id === oid)!;
    expect(first.status).toBe(
      mode === "delayed"
        ? "processing"
        : mode === "permanent"
          ? "blocked"
          : mode === "partial_thread"
            ? "uncertain"
            : "queued",
    );
    if (mode === "delayed" || mode === "transient") {
      await db.query(
        "update provider_outbox set due_at=now()-interval '1 second' where id=$1",
        [oid],
      );
      await processOutbox(rpc, true);
      rows = (await rpc("read_provider_outbox", {
        p_demo: true,
      })) as typeof rows;
      expect(rows.find((r) => r.id === oid)?.status).toBe("published");
    }
    expect(
      (await readControl(rpc, true)).entities.filter(
        (e) => e.kind === "publication" && e.data.package_id === id,
      ).length,
    ).toBeLessThanOrEqual(1);
  }, 30000);
}
it("stale content cannot dispatch an earlier approved outbox", async () => {
  const id = await approvedPackage();
  const oid = await enqueueOutbox(
      rpc,
      id,
      new Date(Date.now() - 1000).toISOString(),
      true,
    ),
    s = await readControl(rpc, true),
    p = s.entities.find((e) => e.id === id)!;
  await controlAction(
    rpc,
    {
      action: "content_freshness",
      id: p.parent_id,
      evergreen: false,
      fresh_until: "2020-01-01T00:00:00Z",
      confirmed: true,
    },
    "Daniel demo",
    true,
  );
  await processOutbox(rpc, true);
  const rows = (await rpc("read_provider_outbox", { p_demo: true })) as {
    id: string;
    status: string;
    error: string;
  }[];
  expect(rows.find((r) => r.id === oid)?.status).toBe("blocked");
  expect(
    (await readControl(rpc, true)).entities.some(
      (e) => e.kind === "publication" && e.data.package_id === id,
    ),
  ).toBe(false);
});
