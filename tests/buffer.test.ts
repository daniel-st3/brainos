import { describe, expect, it, vi } from "vitest";
import { BufferClient, bufferApi } from "../src/providers/buffer-client";
import type { BufferPayload } from "../src/providers/buffer-carousel";
import type {
  Payload,
  Remote,
  TokenSet,
  Transport,
} from "../src/providers/client";

// These fixtures model https://developers.buffer.com/reference.md, not live accounts.
const token: TokenSet = {
  access_token: "buffer-fixture-NOT-A-REAL-KEY",
  expires_at: Date.now() + 3600000,
  scopes: [],
};
const payload: Payload = {
  title: "Test title",
  caption: "Test caption",
  thread: [],
  source_links: [],
  media_urls: [],
};
const video: Payload = {
  ...payload,
  media: {
    url: "https://fixture.supabase.co/functions/v1/approved-media/fixture.mp4?cap=opaque-fixture",
    bytes: 1000,
    mime: "video/mp4",
    duration: 30,
    width: 720,
    height: 1280,
    codec: "h264",
    sha256: "fixture-approved-hash",
  },
};
const imagePayload: Payload = {
  ...payload,
  media_urls: [
    "https://fixture.supabase.co/functions/v1/approved-media/fixture.jpg?cap=opaque-fixture",
  ],
  images: [
    {
      url: "https://fixture.supabase.co/functions/v1/approved-media/fixture.jpg?cap=opaque-fixture",
      mime: "image/jpeg",
      bytes: 1000,
      width: 960,
      height: 1200,
      sha256: "fixture-approved-hash",
    },
  ],
};
const channel = (service = "twitter", more = {}) => ({
  id: "buffer-channel-fixture",
  service,
  serviceId: "social-id-fixture",
  organizationId: "org-fixture",
  name: "fixturehandle",
  displayName: "Fixture Name",
  type: "business",
  isDisconnected: false,
  isLocked: false,
  isQueuePaused: false,
  allowedActions: ["scheduleUpdates"],
  scopes: ["instagram_business_content_publish"],
  ...more,
});
const post = (more = {}) => ({
  id: "buffer-post-fixture",
  channelId: "buffer-channel-fixture",
  channelService: "twitter",
  status: "scheduled",
  sentAt: null,
  dueAt: null,
  externalLink: null,
  schedulingType: "automatic",
  allowedActions: [
    "deletePost",
    "updatePost",
    "updatePostSchedule",
    "addPostToQueue",
    "publishPostNow",
  ],
  ...more,
});
const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const transport = (...responses: Response[]) =>
  vi.fn<Transport>(async () => {
    const response = responses.shift();
    if (!response) throw Error("Unexpected fixture request");
    return response;
  });
const requestBody = (send: ReturnType<typeof transport>, index: number) =>
  JSON.parse(String(send.mock.calls[index][1]?.body)) as {
    query: string;
    variables: { input: Record<string, unknown> };
  };
const success = (value: unknown) =>
  json({
    data: {
      createPost: { __typename: "PostActionSuccess", post: value },
    },
  });

describe("Buffer official free transport", () => {
  const carousel: BufferPayload = {
    ...payload,
    caption: "Exact caption.\n\nFinal line.\n",
    carousel: [
      {
        kind: "video",
        ...video.media!,
        width: 1080,
        height: 1350,
        duration: 4,
        bytes: 841238,
        sha256: "1".repeat(64),
      },
      ...["02", "03"].map((name) => ({
        kind: "image" as const,
        url: `https://fixture.supabase.co/functions/v1/approved-media/${name}.png?cap=opaque-fixture`,
        mime: "image/png",
        width: 1080,
        height: 1350,
        bytes: 632852,
        sha256: name.slice(1).repeat(64),
      })),
    ],
  };

  it("preserves explicit mixed carousel order and exact caption without treating the child as a Reel", async () => {
    const send = transport(
      json({ data: { channel: channel("instagram") } }),
      success(post({ channelService: "instagram", status: "draft" })),
    );
    const result = await new BufferClient(
      "instagram",
      token,
      send,
      true,
    ).createDraft("buffer-channel-fixture", carousel);
    expect(result.status).toBe("draft");
    const input = requestBody(send, 1).variables.input;
    expect(input).toMatchObject({
      text: carousel.caption,
      saveToDraft: true,
      mode: "addToQueue",
      metadata: { instagram: { type: "post", shouldShareToFeed: true } },
      assets: [
        {
          video: {
            url: carousel.carousel![0].url,
            metadata: { thumbnailOffset: 0 },
          },
        },
        { image: { url: carousel.carousel![1].url } },
        { image: { url: carousel.carousel![2].url } },
      ],
    });
    expect(input).not.toHaveProperty("dueAt");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never sorts carousel children by media type", async () => {
    const ordered = {
      ...carousel,
      carousel: [...carousel.carousel!].reverse(),
    };
    const send = transport(
      json({ data: { channel: channel("instagram") } }),
      success(post({ channelService: "instagram", status: "draft" })),
    );
    await new BufferClient("instagram", token, send, true).createDraft(
      "buffer-channel-fixture",
      ordered,
    );
    expect(requestBody(send, 1).variables.input.assets).toEqual([
      { image: { url: ordered.carousel[0].url } },
      { image: { url: ordered.carousel[1].url } },
      {
        video: {
          url: ordered.carousel[2].url,
          metadata: { thumbnailOffset: 0 },
        },
      },
    ]);
  });

  it("rejects ambiguous ordering, missing checksums, cropping, invalid child media and unstable delivery URLs before network", async () => {
    const send = transport();
    const variants: BufferPayload[] = [
      { ...carousel, media: video.media },
      { ...carousel, media_urls: imagePayload.media_urls },
      { ...carousel, carousel: [] },
      { ...carousel, carousel: [carousel.carousel![0]] },
      { ...carousel, carousel: Array(11).fill(carousel.carousel![0]) },
      ...[
        { sha256: "" },
        { width: 100 },
        { width: 1081 },
        { mime: "image/svg+xml" },
        { bytes: 8_000_001 },
        { url: "https://localhost/private.png" },
        {
          url: "https://fixture.supabase.co/storage/v1/object/sign/private.png?token=test",
        },
      ].map((patch) => ({
        ...carousel,
        carousel: [
          carousel.carousel![0],
          { ...carousel.carousel![1], ...patch },
          carousel.carousel![2],
        ],
      })),
      {
        ...carousel,
        carousel: [
          {
            ...video.media!,
            kind: "video",
            width: 1080,
            height: 1350,
            sha256: "1".repeat(64),
            duration: NaN,
          },
          ...carousel.carousel!.slice(1),
        ],
      },
    ];
    for (const value of variants)
      await expect(
        new BufferClient("instagram", token, send, true).createDraft(
          "buffer-channel-fixture",
          value,
        ),
      ).rejects.toBeInstanceOf(Error);
    await expect(
      new BufferClient("tiktok", token, send, true).createDraft(
        "buffer-channel-fixture",
        carousel,
      ),
    ).rejects.toMatchObject({ code: "BUFFER_CAROUSEL_PLATFORM_UNSUPPORTED" });
    await expect(
      new BufferClient("instagram", token, send).createDraft(
        "buffer-channel-fixture",
        carousel,
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_PUBLISHING_DISABLED" });
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects unsupported platforms and missing/expired credentials before network access", async () => {
    const send = transport();
    expect(() => new BufferClient("youtube", token, send)).toThrow(
      "BUFFER_PLATFORM_UNSUPPORTED",
    );
    await expect(
      new BufferClient("x", { ...token, access_token: "" }, send).discover(),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(
      new BufferClient("x", { ...token, expires_at: 0 }, send).discover(),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("discovers connected channels with real IDs and does not claim unavailable biography/analytics", async () => {
    const send = transport(
      json({ data: { account: { organizations: [{ id: "org-fixture" }] } } }),
      json({
        data: {
          channels: [
            channel(),
            channel("youtube"),
            channel("twitter", {
              id: "locked-channel",
              isLocked: true,
            }),
          ],
        },
      }),
    );
    const found = await new BufferClient("x", token, send).discover();
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      id: "buffer-channel-fixture",
      handle: "fixturehandle",
      bio: "",
      capabilities: ["profile_read", "publish", "media_upload", "schedule"],
      raw: { serviceId: "social-id-fixture", profile_bio_available: false },
    });
    expect(found[0].capabilities).not.toContain("analytics");
    expect(found[1]).toMatchObject({
      capabilities: ["profile_read"],
      blockers: ["BUFFER_CHANNEL_LOCKED"],
    });
    expect(send.mock.calls[0][0]).toBe(bufferApi);
    expect(send.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Bearer ${token.access_token}`,
    });
    expect(requestBody(send, 1).variables).toEqual({
      input: { organizationId: "org-fixture" },
    });
  });

  it("does not advertise automatic Instagram publishing for a reminder-only or unverified account", async () => {
    const send = transport(
      json({ data: { account: { organizations: [{ id: "org-fixture" }] } } }),
      json({
        data: {
          channels: [channel("instagram", { scopes: [], type: "profile" })],
        },
      }),
    );
    expect(
      (await new BufferClient("instagram", token, send).discover())[0],
    ).toMatchObject({
      capabilities: ["profile_read"],
      blockers: ["BUFFER_INSTAGRAM_PUBLISH_SCOPE_UNVERIFIED"],
    });
  });

  it("requires the exact account and explicit write enablement", async () => {
    const send = transport();
    const c = new BufferClient(
      "x",
      { ...token, account_id: "expected" },
      send,
      true,
    );
    await expect(c.publish("", payload)).rejects.toMatchObject({
      code: "ACCOUNT_ID_MISSING",
    });
    await expect(c.publish("other", payload)).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
    });
    await expect(
      new BufferClient("x", token, send).publish("expected", payload),
    ).rejects.toMatchObject({ code: "EXTERNAL_PUBLISHING_DISABLED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("verifies the selected channel still belongs to the intended platform before writing", async () => {
    const send = transport(json({ data: { channel: channel("instagram") } }));
    await expect(
      new BufferClient("x", token, send, true).publish(
        "buffer-channel-fixture",
        payload,
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("creates one scheduled X thread, with the root included, and checkpoints the Buffer ID", async () => {
    const send = transport(
      json({ data: { channel: channel() } }),
      success(post()),
    );
    const saved: Remote[] = [];
    const result = await new BufferClient("x", token, send, true).publish(
      "buffer-channel-fixture",
      {
        ...payload,
        thread: ["Root", "Reply"],
        publish_at: "2099-01-01T12:00:00Z",
      },
      {},
      async (r) => {
        saved.push(r);
      },
    );
    expect(requestBody(send, 1).variables.input).toMatchObject({
      channelId: "buffer-channel-fixture",
      text: "Root",
      mode: "customScheduled",
      schedulingType: "automatic",
      dueAt: "2099-01-01T12:00:00.000Z",
      metadata: {
        twitter: {
          thread: [
            { text: "Root", assets: [] },
            { text: "Reply", assets: [] },
          ],
        },
      },
    });
    expect(saved[0].status).toBe("dispatching");
    expect(saved[1]).toMatchObject({
      id: "buffer-post-fixture",
      status: "processing",
    });
    expect(result).toMatchObject({
      id: "buffer-post-fixture",
      status: "scheduled",
    });
    expect(result.published_at).toBeUndefined();
  });

  it("uses required Instagram Reel metadata with approved stable URL ingestion", async () => {
    const send = transport(
      json({ data: { channel: channel("instagram") } }),
      success(post({ channelService: "instagram" })),
    );
    await new BufferClient("instagram", token, send, true).publish(
      "buffer-channel-fixture",
      video,
    );
    expect(requestBody(send, 1).variables.input).toMatchObject({
      metadata: { instagram: { type: "reel", shouldShareToFeed: true } },
      assets: [{ video: { url: video.media!.url } }],
      mode: "shareNow",
    });
    expect(send.mock.calls.every(([url]) => url === bufferApi)).toBe(true);
  });

  it("creates TikTok video drafts without treating them as published", async () => {
    const send = transport(
      json({ data: { channel: channel("tiktok") } }),
      success(
        post({
          channelService: "tiktok",
          status: "draft",
        }),
      ),
    );
    const result = await new BufferClient(
      "tiktok",
      token,
      send,
      true,
    ).createDraft("buffer-channel-fixture", video);
    expect(requestBody(send, 1).variables.input).toMatchObject({
      saveToDraft: true,
      mode: "addToQueue",
    });
    expect(result.status).toBe("draft");
  });

  it("rejects audience overrides, expiring URLs and internal URLs before sending", async () => {
    const send = transport();
    const c = new BufferClient("tiktok", token, send, true);
    await expect(
      c.publish("buffer-channel-fixture", { ...video, privacy: "SELF_ONLY" }),
    ).rejects.toMatchObject({ code: "BUFFER_PRIVACY_OVERRIDE_UNSUPPORTED" });
    for (const url of [
      "http://media.example/clip.mp4",
      "https://localhost/clip.mp4",
      "https://172.16.0.1/clip.mp4",
      "https://fixture.supabase.co/storage/v1/object/sign/bucket/clip.mp4?token=x",
      "https://media.example/clip.mp4?X-Amz-Expires=3600",
    ]) {
      await expect(
        c.publish("buffer-channel-fixture", {
          ...video,
          media: { ...video.media!, url },
        }),
      ).rejects.toMatchObject({ code: "STABLE_MEDIA_URL_REQUIRED" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["draft", "scheduled", "sending", "needs_approval"])(
    "%s never means published even with an external link",
    async (status) => {
      const send = transport(
        json({
          data: {
            post: post({
              status,
              externalLink: "https://x.com/i/status/fixture",
            }),
          },
        }),
      );
      const result = await new BufferClient("x", token, send).lookup(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture" },
      );
      expect(result.status).not.toBe("published");
      expect(result.published_at).toBeUndefined();
    },
  );

  it("requires sentAt and automatic delivery; confirmed publication uses provider time", async () => {
    const sentAt = "2026-01-01T12:00:00Z";
    const send = transport(
      json({ data: { post: post({ status: "sent" }) } }),
      json({
        data: {
          post: post({
            status: "sent",
            sentAt,
            schedulingType: "notification",
          }),
        },
      }),
      json({
        data: {
          post: post({
            status: "sent",
            sentAt,
            externalLink: "https://x.com/i/status/fixture",
          }),
        },
      }),
    );
    const c = new BufferClient("x", token, send);
    expect(
      (await c.lookup("buffer-channel-fixture", { id: "buffer-post-fixture" }))
        .status,
    ).toBe("processing");
    expect(
      (await c.lookup("buffer-channel-fixture", { id: "buffer-post-fixture" }))
        .status,
    ).toBe("manual_action_required");
    expect(
      await c.lookup("buffer-channel-fixture", { id: "buffer-post-fixture" }),
    ).toMatchObject({
      status: "published",
      published_at: "2026-01-01T12:00:00.000Z",
      url: "https://x.com/i/status/fixture",
    });
  });

  it("reuses a checkpointed post ID and never creates again on resume", async () => {
    const send = transport(json({ data: { post: post() } }));
    const c = new BufferClient("x", token, send, true);
    await c.publish("buffer-channel-fixture", payload, {
      id: "buffer-post-fixture",
    });
    expect(send).toHaveBeenCalledOnce();
    expect(requestBody(send, 0).query).toContain("query BufferPost");
    await expect(
      c.publish("buffer-channel-fixture", payload, { status: "dispatching" }),
    ).rejects.toMatchObject({ uncertain: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it("429 preserves Retry-After and clears pre-dispatch intent only after a definite rejection", async () => {
    const send = transport(
      json({ data: { channel: channel() } }),
      json({ error: token.access_token }, 429, { "Retry-After": "125" }),
    );
    const saved: Remote[] = [];
    await expect(
      new BufferClient("x", token, send, true).publish(
        "buffer-channel-fixture",
        payload,
        {},
        async (r) => {
          saved.push(r);
        },
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMIT",
      retryable: true,
      uncertain: false,
      retryAfter: 125,
    });
    expect(saved.at(-1)?.status).toBe("not_submitted");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])(
    "normalizes HTTP %s without exposing the key",
    async (status) => {
      const send = transport(json({ error: token.access_token }, status));
      const c = new BufferClient("x", token, send);
      await expect(c.discover()).rejects.toMatchObject({
        code: status === 401 ? "TOKEN_EXPIRED" : "INSUFFICIENT_SCOPE",
      });
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it("normalizes GraphQL auth errors in HTTP 200", async () => {
    const send = transport(
      json({
        errors: [
          { message: token.access_token, extensions: { code: "UNAUTHORIZED" } },
        ],
      }),
    );
    await expect(new BufferClient("x", token, send).discover()).rejects.toThrow(
      "TOKEN_EXPIRED",
    );
  });

  it("records an interrupted write as uncertain without automatic mutation retries", async () => {
    const send = vi
      .fn<Transport>()
      .mockResolvedValueOnce(json({ data: { channel: channel() } }))
      .mockRejectedValueOnce(Error(`private ${token.access_token}`));
    const saved: Remote[] = [];
    await expect(
      new BufferClient("x", token, send, true).publish(
        "buffer-channel-fixture",
        payload,
        {},
        async (r) => {
          saved.push(r);
        },
      ),
    ).rejects.toMatchObject({
      code: "NETWORK_FAILURE",
      retryable: false,
      uncertain: true,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(saved.at(-1)?.status).toBe("dispatching");
  });

  it("preserves a created ID from partial GraphQL success so reconciliation cannot duplicate it", async () => {
    const send = transport(
      json({ data: { channel: channel() } }),
      json({
        data: { createPost: { __typename: "PostActionSuccess", post: post() } },
        errors: [
          {
            message: "Field temporarily unavailable",
            extensions: { code: "UNEXPECTED" },
          },
        ],
      }),
    );
    const saved: Remote[] = [];
    const result = await new BufferClient("x", token, send, true).publish(
      "buffer-channel-fixture",
      payload,
      {},
      async (r) => {
        saved.push(r);
      },
    );
    expect(result).toMatchObject({
      id: "buffer-post-fixture",
      status: "uncertain",
    });
    expect(saved.at(-1)?.id).toBe("buffer-post-fixture");
  });

  it.each([408, 502])(
    "HTTP %s leaves a possible write uncertain without retrying",
    async (status) => {
      const send = transport(
        json({ data: { channel: channel() } }),
        json({ error: "Upstream request interrupted" }, status),
      );
      const saved: Remote[] = [];
      await expect(
        new BufferClient("x", token, send, true).publish(
          "buffer-channel-fixture",
          payload,
          {},
          async (r) => {
            saved.push(r);
          },
        ),
      ).rejects.toMatchObject({ retryable: false, uncertain: true });
      expect(saved.at(-1)?.status).toBe("dispatching");
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it("does not trust a foreign account's post", async () => {
    const send = transport(
      json({ data: { post: post({ channelId: "other-account" }) } }),
    );
    await expect(
      new BufferClient("x", token, send).lookup("buffer-channel-fixture", {
        id: "buffer-post-fixture",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  });

  it("separates actual capture time from provider refresh time and preserves unnormalized metrics", async () => {
    const published = post({ status: "sent", sentAt: "2026-01-01T12:00:00Z" });
    const reportedMetrics = [
      { type: "reactions", name: "Reactions", value: 0, unit: "count" },
      { type: "views", name: "Views", value: 12, unit: "count" },
      { type: "duration", name: "Duration", value: 7, unit: "seconds" },
      { type: "unavailable", name: "Unavailable", value: null, unit: "count" },
    ];
    const send = transport(
      json({
        data: { post: { ...published, metrics: null, metricsUpdatedAt: null } },
      }),
      json({
        data: {
          post: {
            ...published,
            metrics: reportedMetrics,
            metricsUpdatedAt: "2026-01-02T00:00:00Z",
          },
        },
      }),
    );
    const c = new BufferClient("x", token, send);
    await expect(
      c.metrics("buffer-channel-fixture", { id: "buffer-post-fixture" }),
    ).rejects.toMatchObject({ code: "METRICS_UNAVAILABLE" });
    const started = Date.now();
    const result = await c.metrics("buffer-channel-fixture", {
      id: "buffer-post-fixture",
    });
    expect(result).toMatchObject({
      values: { reactions: 0, views: 12 },
      raw: {
        metrics: reportedMetrics,
        metricsUpdatedAt: "2026-01-02T00:00:00Z",
      },
      semantics: "buffer/x/2026-10-02",
    });
    expect(result.values).toEqual({ reactions: 0, views: 12 });
    expect(Date.parse(result.captured_at)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(result.captured_at)).toBeLessThanOrEqual(Date.now());
    expect(result.captured_at).not.toBe(result.raw.metricsUpdatedAt);
  });

  it.each([
    ["draft", "addToQueue", true],
    ["queue", "addToQueue", false],
    ["now", "shareNow", false],
    ["schedule", "customScheduled", false],
  ] as const)(
    "maps explicit %s intent without claiming immediate publication",
    async (mode, expectedMode, draft) => {
      const scheduled_at = "2099-01-01T12:00:00Z";
      const send = transport(
        json({ data: { channel: channel() } }),
        success(
          post({ status: draft ? "draft" : "scheduled", dueAt: scheduled_at }),
        ),
      );
      const result = await new BufferClient("x", token, send, true).publish(
        "buffer-channel-fixture",
        {
          ...payload,
          delivery: { mode, ...(mode === "schedule" ? { scheduled_at } : {}) },
        },
      );
      expect(requestBody(send, 1).variables.input).toMatchObject({
        mode: expectedMode,
        saveToDraft: draft,
      });
      expect(requestBody(send, 1).variables.input.dueAt).toBe(
        mode === "schedule" ? "2099-01-01T12:00:00.000Z" : undefined,
      );
      expect(result.status).not.toBe("published");
      expect(result.due_at).toBe("2099-01-01T12:00:00.000Z");
    },
  );

  it("rejects absent, past, conflicting, or unexpectedly supplied schedule times", async () => {
    const send = transport();
    const client = new BufferClient("x", token, send, true);
    for (const delivery of [
      { mode: "schedule" },
      { mode: "schedule", scheduled_at: "2000-01-01T00:00:00Z" },
      { mode: "queue", scheduled_at: "2099-01-01T00:00:00Z" },
    ] as const)
      await expect(
        client.publish("buffer-channel-fixture", { ...payload, delivery }),
      ).rejects.toMatchObject({ retryable: false });
    await expect(
      client.publish("buffer-channel-fixture", {
        ...payload,
        delivery: { mode: "schedule", scheduled_at: "2099-01-01T00:00:00Z" },
        publish_at: "2099-01-02T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "SCHEDULE_TIME_CONFLICT" });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps unverified channel format and analytics capabilities unknown", async () => {
    const send = transport(
      json({ data: { account: { organizations: [{ id: "org-fixture" }] } } }),
      json({
        data: {
          channels: [channel("instagram", { hasActiveMemberDevice: true })],
        },
      }),
    );
    const [identity] = await new BufferClient(
      "instagram",
      token,
      send,
    ).discover();
    expect(identity.raw.buffer_capabilities).toEqual({
      network: "instagram",
      id: "buffer-channel-fixture",
      display: "Fixture Name",
      text: null,
      image: null,
      video: null,
      reels: null,
      carousel: null,
      threads: null,
      automatic: true,
      notification: true,
      schedule: true,
      analytics: null,
    });
    expect(identity.raw.declared_formats).toContain("reels");
  });

  it("requires metadata bound to every image, validates dimensions and MIME, and allows the shared safe Instagram aspect range", async () => {
    const send = transport(
      json({ data: { channel: channel("instagram") } }),
      success(post({ channelService: "instagram" })),
    );
    const c = new BufferClient("instagram", token, send, true);
    for (const p of [
      { ...imagePayload, images: undefined },
      {
        ...imagePayload,
        images: [
          {
            ...imagePayload.images![0],
            url: "https://other.example/wrong.jpg",
          },
        ],
      },
      {
        ...imagePayload,
        images: [{ ...imagePayload.images![0], mime: "image/png" }],
      },
      {
        ...imagePayload,
        images: [{ ...imagePayload.images![0], width: 100, height: 200 }],
      },
      {
        ...imagePayload,
        images: [{ ...imagePayload.images![0], bytes: 8_000_001 }],
      },
    ])
      await expect(
        c.publish("buffer-channel-fixture", p),
      ).rejects.toMatchObject({ retryable: false });
    expect(send).not.toHaveBeenCalled();
    await c.publish("buffer-channel-fixture", imagePayload);
    expect(requestBody(send, 1).variables.input).toMatchObject({
      assets: [{ image: { url: imagePayload.media_urls[0] } }],
      metadata: { instagram: { type: "post", shouldShareToFeed: true } },
    });
  });

  it("supports validated TikTok photo posts and rejects Buffer-specific video limits", async () => {
    const send = transport(
      json({ data: { channel: channel("tiktok") } }),
      success(post({ channelService: "tiktok" })),
    );
    await new BufferClient("tiktok", token, send, true).publish(
      "buffer-channel-fixture",
      imagePayload,
    );
    expect(requestBody(send, 1).variables.input).toMatchObject({
      metadata: { tiktok: { title: payload.title } },
      assets: [{ image: { url: imagePayload.media_urls[0] } }],
    });
    const none = transport();
    await expect(
      new BufferClient("x", token, none, true).publish(
        "buffer-channel-fixture",
        { ...video, media: { ...video.media!, duration: 141 } },
      ),
    ).rejects.toMatchObject({ code: "BUFFER_X_DURATION_LIMIT" });
    await expect(
      new BufferClient("instagram", token, none, true).publish(
        "buffer-channel-fixture",
        { ...video, media: { ...video.media!, duration: 4 } },
      ),
    ).rejects.toMatchObject({ code: "BUFFER_INSTAGRAM_DURATION_LIMIT" });
    await expect(
      new BufferClient("tiktok", token, none, true).publish(
        "buffer-channel-fixture",
        { ...video, media: { ...video.media!, duration: 601 } },
      ),
    ).rejects.toMatchObject({ code: "BUFFER_TIKTOK_DURATION_LIMIT" });
    expect(none).not.toHaveBeenCalled();
  });

  it("promotes an existing draft with editPost and preserves its remote identity", async () => {
    const send = transport(
      json({ data: { post: post({ status: "draft" }) } }),
      json({ data: { channel: channel() } }),
      json({
        data: { editPost: { __typename: "PostActionSuccess", post: post() } },
      }),
    );
    const saved: Remote[] = [];
    const result = await new BufferClient("x", token, send, true).updateDraft(
      "buffer-channel-fixture",
      { id: "buffer-post-fixture", status: "draft" },
      { ...payload, delivery: { mode: "queue" } },
      async (r) => {
        saved.push(r);
      },
    );
    expect(requestBody(send, 2).query).toContain("editPost");
    expect(requestBody(send, 2).variables.input).toMatchObject({
      id: "buffer-post-fixture",
      mode: "addToQueue",
      saveToDraft: false,
    });
    expect(requestBody(send, 2).variables.input).not.toHaveProperty(
      "channelId",
    );
    expect(saved[0]).toMatchObject({
      id: "buffer-post-fixture",
      status: "dispatching",
      buffer_operation: "editPost",
    });
    expect(result).toMatchObject({
      id: "buffer-post-fixture",
      status: "scheduled",
    });
  });

  it("does not edit non-drafts or automatically repeat an uncertain edit", async () => {
    const send = transport(json({ data: { post: post() } }));
    const c = new BufferClient("x", token, send, true);
    await expect(
      c.updateDraft(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture" },
        payload,
      ),
    ).rejects.toMatchObject({ code: "BUFFER_DRAFT_EDIT_UNAVAILABLE" });
    await expect(
      c.updateDraft(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture", status: "uncertain" },
        payload,
      ),
    ).rejects.toMatchObject({
      code: "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION",
      uncertain: true,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("cancels only a freshly confirmed unsent post and checkpoints intent before deletion", async () => {
    const send = transport(
      json({ data: { post: post() } }),
      json({
        data: {
          deletePost: {
            __typename: "DeletePostSuccess",
            id: "buffer-post-fixture",
          },
        },
      }),
    );
    const saved: Remote[] = [];
    const result = await new BufferClient("x", token, send, true).cancel(
      "buffer-channel-fixture",
      { id: "buffer-post-fixture" },
      async (r) => {
        saved.push(r);
      },
    );
    expect(saved[0]).toMatchObject({
      status: "cancelling",
      buffer_cancel_requested: true,
      id: "buffer-post-fixture",
    });
    expect(requestBody(send, 1).variables.input).toEqual({
      id: "buffer-post-fixture",
    });
    expect(result.status).toBe("cancelled");
  });

  it.each([
    { status: "sent", sentAt: "2026-01-01T12:00:00Z" },
    { status: "sending" },
    { status: "error" },
    { allowedActions: [] },
    { status: "scheduled", sentAt: "2026-01-01T12:00:00Z" },
    { channelId: "other-account" },
  ])("refuses unsafe cancellation %j", async (more) => {
    const send = transport(json({ data: { post: post(more) } }));
    await expect(
      new BufferClient("x", token, send, true).cancel(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture" },
      ),
    ).rejects.toMatchObject({ retryable: false });
    expect(send).toHaveBeenCalledOnce();
  });

  it("gates cancellation and draft edits on write activation", async () => {
    const send = transport(),
      c = new BufferClient("x", token, send);
    await expect(
      c.cancel("buffer-channel-fixture", { id: "buffer-post-fixture" }),
    ).rejects.toMatchObject({ code: "EXTERNAL_PUBLISHING_DISABLED" });
    await expect(
      c.updateDraft(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture" },
        payload,
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_PUBLISHING_DISABLED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("restores the known remote checkpoint after a definite cancellation rejection", async () => {
    const send = transport(
      json({ data: { post: post() } }),
      json({}, 429, { "retry-after": "42" }),
    );
    const saved: Remote[] = [];
    await expect(
      new BufferClient("x", token, send, true).cancel(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture" },
        async (r) => {
          saved.push(r);
        },
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMIT",
      retryable: true,
      retryAfter: 42,
      uncertain: false,
    });
    expect(saved.at(-1)).toMatchObject({ status: "scheduled" });
    expect(saved.at(-1)?.buffer_cancel_requested).toBeUndefined();
  });

  it("retains uncertain cancellation and recognizes absence only after a bound deletion checkpoint", async () => {
    const send = transport(json({ data: { post: post() } }));
    const saved: Remote[] = [];
    await expect(
      new BufferClient("x", token, send, true).cancel(
        "buffer-channel-fixture",
        { id: "buffer-post-fixture" },
        async (r) => {
          saved.push(r);
        },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_FAILURE", uncertain: true });
    expect(saved.at(-1)).toMatchObject({
      status: "cancelling",
      buffer_cancel_requested: true,
    });
    const read = transport(json({}, 404), json({}, 404));
    const c = new BufferClient("x", token, read);
    expect(
      (await c.lookup("buffer-channel-fixture", saved.at(-1)!)).status,
    ).toBe("cancelled");
    await expect(
      c.lookup("buffer-channel-fixture", { id: "buffer-post-fixture" }),
    ).rejects.toMatchObject({ code: "REMOTE_NOT_FOUND" });
  });
});
