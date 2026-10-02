import type { Provider } from "../control/model";
import {
  ProviderError,
  type Identity,
  type Payload,
  type Remote,
  type TokenSet,
  type Transport,
} from "./client";
import { validatePayload } from "./validation";

// Official contract, checked 2026-10-02:
// https://developers.buffer.com/reference.md
// https://developers.buffer.com/guides/error-handling.html
// https://developers.buffer.com/guides/hosting-media.html
// https://developers.buffer.com/guides/post-metrics.html
export const bufferApi = "https://api.buffer.com";
export type BufferProvider = "instagram" | "tiktok" | "x";
export interface BufferChannelCapabilities {
  network: BufferProvider;
  id: string;
  display: string;
  text: boolean | null;
  image: boolean | null;
  video: boolean | null;
  reels: boolean | null;
  carousel: boolean | null;
  threads: boolean | null;
  automatic: boolean | null;
  notification: boolean | null;
  schedule: boolean | null;
  analytics: boolean | null;
}
const services: Record<BufferProvider, string> = {
  instagram: "instagram",
  tiktok: "tiktok",
  x: "twitter",
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const rows = (v: unknown) => (Array.isArray(v) ? v.map(object) : []);
const string = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const channelFields = `id name displayName service serviceId organizationId type
  isDisconnected isLocked isQueuePaused hasActiveMemberDevice allowedActions scopes externalLink`;
const postFields = `id channelId channelService status sentAt dueAt externalLink
  schedulingType allowedActions error { message }`;
const retryAfter = (value: string | null) => {
  if (!value) return 3600;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric)
    ? numeric
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 3600;
};

/** Buffer owns the social OAuth connections; tokens.access_token is a personal Buffer key. */
export class BufferClient {
  readonly provider: BufferProvider;
  constructor(
    provider: Provider,
    public tokens: TokenSet,
    private send: Transport = fetch,
    private writes = false,
  ) {
    if (!Object.hasOwn(services, provider))
      throw new ProviderError("BUFFER_PLATFORM_UNSUPPORTED");
    this.provider = provider as BufferProvider;
  }

  private authorize() {
    if (!this.tokens.access_token?.trim())
      throw new ProviderError("AUTH_REQUIRED");
    if (
      !Number.isFinite(this.tokens.expires_at) ||
      this.tokens.expires_at <= Date.now()
    )
      throw new ProviderError("TOKEN_EXPIRED");
  }

  private account(account: string) {
    this.authorize();
    if (!account?.trim()) throw new ProviderError("ACCOUNT_ID_MISSING");
    if (this.tokens.account_id && this.tokens.account_id !== account)
      throw new ProviderError("ACCOUNT_MISMATCH");
  }

  private async request(
    query: string,
    variables: Record<string, unknown> = {},
    mutation = false,
  ): Promise<Record<string, unknown>> {
    this.authorize();
    if (mutation && !this.writes)
      throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
    let response: Response;
    try {
      response = await this.send(bufferApi, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.tokens.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new ProviderError("NETWORK_FAILURE", !mutation, mutation);
    }
    const wait = retryAfter(response.headers.get("retry-after"));
    if (!response.ok) {
      if (response.status === 429)
        throw new ProviderError("RATE_LIMIT", true, false, wait);
      if (response.status === 401) throw new ProviderError("TOKEN_EXPIRED");
      if (response.status === 403)
        throw new ProviderError("INSUFFICIENT_SCOPE");
      if (response.status === 404) throw new ProviderError("REMOTE_NOT_FOUND");
      throw new ProviderError(
        response.status >= 500 ? "REMOTE_FAILURE" : "PROVIDER_REJECTED",
        !mutation && response.status >= 500,
        mutation && (response.status >= 500 || response.status === 408),
        wait,
      );
    }
    let result: Record<string, unknown>;
    try {
      result = object(await response.json());
    } catch {
      throw new ProviderError("INVALID_PROVIDER_RESPONSE", !mutation, mutation);
    }
    const errors = rows(result.errors);
    if (errors.length) {
      // A partial mutation response can contain a created post AND errors. Preserve
      // its ID below, and reconcile instead of retrying creation without its ID.
      if (
        mutation &&
        ["createPost", "editPost", "deletePost"].some((key) => {
          const value = object(object(result.data)[key]);
          return (
            value.post ||
            (key === "deletePost" &&
              value.__typename === "DeletePostSuccess" &&
              value.id)
          );
        })
      )
        return { ...object(result.data), partialMutation: true };
      const codes = errors.map((e) => string(object(e.extensions).code));
      if (codes.includes("UNAUTHORIZED") || codes.includes("UNAUTHENTICATED"))
        throw new ProviderError("TOKEN_EXPIRED");
      if (codes.includes("FORBIDDEN"))
        throw new ProviderError("INSUFFICIENT_SCOPE");
      if (codes.includes("RATE_LIMIT_EXCEEDED"))
        throw new ProviderError("RATE_LIMIT", true, false, wait);
      if (codes.includes("NOT_FOUND"))
        throw new ProviderError("REMOTE_NOT_FOUND");
      if (
        codes.includes("GRAPHQL_VALIDATION_FAILED") ||
        codes.includes("BAD_USER_INPUT")
      )
        throw new ProviderError("PROVIDER_REJECTED");
      throw new ProviderError("REMOTE_FAILURE", !mutation, mutation, wait);
    }
    if (!result.data || typeof result.data !== "object")
      throw new ProviderError("INVALID_PROVIDER_RESPONSE", !mutation, mutation);
    return object(result.data);
  }

  private identity(channel: Record<string, unknown>): Identity {
    const id = string(channel.id);
    if (!id) throw new ProviderError("ACCOUNT_ID_MISSING");
    if (channel.service !== services[this.provider])
      throw new ProviderError("ACCOUNT_MISMATCH");
    const blockers: string[] = [];
    if (channel.isDisconnected !== false)
      blockers.push("BUFFER_CHANNEL_DISCONNECTED");
    if (channel.isLocked !== false) blockers.push("BUFFER_CHANNEL_LOCKED");
    if (channel.isQueuePaused !== false) blockers.push("BUFFER_QUEUE_PAUSED");
    if (!strings(channel.allowedActions).includes("scheduleUpdates"))
      blockers.push("PUBLISH_CAPABILITY_UNAVAILABLE");
    // Personal Instagram profiles only support reminders. Do not infer automatic
    // publishing from scheduleUpdates, which can also authorize notification posts.
    if (
      this.provider === "instagram" &&
      !strings(channel.scopes).some((s) =>
        [
          "instagram_content_publish",
          "instagram_business_content_publish",
        ].includes(s),
      )
    )
      blockers.push("BUFFER_INSTAGRAM_PUBLISH_SCOPE_UNVERIFIED");
    const ready = blockers.length === 0;
    const capabilities: BufferChannelCapabilities = {
      network: this.provider,
      id,
      display: string(channel.displayName) || string(channel.name),
      // Channel does not return content configuration. These fields remain
      // unknown, distinct from the network's documented format support below.
      text: null,
      image: null,
      video: null,
      reels: null,
      carousel: null,
      threads: null,
      automatic: ready
        ? true
        : blockers.includes("BUFFER_INSTAGRAM_PUBLISH_SCOPE_UNVERIFIED")
          ? null
          : false,
      notification:
        this.provider === "x"
          ? false
          : channel.isDisconnected === true ||
              channel.isLocked === true ||
              channel.hasActiveMemberDevice === false
            ? false
            : channel.hasActiveMemberDevice === true &&
                strings(channel.allowedActions).includes("scheduleUpdates")
              ? true
              : null,
      schedule: ready,
      analytics: null,
    };
    return {
      id,
      handle: string(channel.name),
      name: string(channel.displayName) || string(channel.name),
      bio: "", // The Channel contract has no biography field.
      capabilities: blockers.length
        ? ["profile_read"]
        : ["profile_read", "publish", "media_upload", "schedule"],
      blockers,
      raw: {
        ...channel,
        transport: "buffer",
        profile_bio_available: false,
        buffer_capabilities: capabilities,
        // Static support is not evidence that this channel has every permission.
        declared_formats:
          this.provider === "instagram"
            ? ["image", "video", "reels", "carousel"]
            : this.provider === "tiktok"
              ? ["image", "video", "carousel"]
              : ["text", "image", "video", "threads"],
        declared_formats_source:
          this.provider === "instagram"
            ? "https://support.buffer.com/en-us/articles/using-instagram-with-buffer-YSjg2dXFV8"
            : this.provider === "tiktok"
              ? "https://support.buffer.com/en-us/articles/using-tiktok-with-buffer-oGEroY9Of2"
              : "https://support.buffer.com/en-us/articles/using-xtwitter-with-buffer-nA84XnWtuU",
      },
    };
  }

  async discover(): Promise<Identity[]> {
    const data = await this.request(`query BufferOrganizations {
      account { organizations { id } }
    }`);
    if (!Array.isArray(object(data.account).organizations))
      throw new ProviderError("INVALID_PROVIDER_RESPONSE");
    const found: Identity[] = [];
    for (const organization of rows(object(data.account).organizations)) {
      const id = string(organization.id);
      if (!id) throw new ProviderError("ORGANIZATION_ID_MISSING");
      const next = await this.request(
        `query BufferChannels($input: ChannelsInput!) {
        channels(input: $input) { ${channelFields} }
      }`,
        { input: { organizationId: id } },
      );
      if (!Array.isArray(next.channels))
        throw new ProviderError("INVALID_PROVIDER_RESPONSE");
      for (const channel of rows(next.channels)) {
        if (channel.service !== services[this.provider]) continue;
        const identity = this.identity(channel);
        if (!this.tokens.account_id || this.tokens.account_id === identity.id)
          found.push(identity);
      }
    }
    return found;
  }

  private async verifyChannel(account: string) {
    this.account(account);
    const data = await this.request(
      `query BufferChannel($input: ChannelInput!) {
      channel(input: $input) { ${channelFields} }
    }`,
      { input: { id: account } },
    );
    const identity = this.identity(object(data.channel));
    if (identity.id !== account) throw new ProviderError("ACCOUNT_MISMATCH");
    if (identity.blockers.length) throw new ProviderError(identity.blockers[0]);
  }

  private normalize(
    account: string,
    value: unknown,
    previous: Remote = {},
  ): Remote {
    const post = object(value),
      id = string(post.id);
    if (!id) throw new ProviderError("REMOTE_ID_MISSING", false, true);
    if (
      (previous.id && previous.id !== id) ||
      post.channelId !== account ||
      post.channelService !== services[this.provider]
    )
      throw new ProviderError("ACCOUNT_MISMATCH");
    const sentAt = Date.parse(string(post.sentAt));
    const published =
      post.status === "sent" &&
      post.schedulingType === "automatic" &&
      Number.isFinite(sentAt) &&
      sentAt <= Date.now();
    const known = [
      "draft",
      "error",
      "needs_approval",
      "scheduled",
      "sending",
      "sent",
    ];
    const status = published
      ? "published"
      : post.status === "error"
        ? "rejected"
        : post.schedulingType === "notification"
          ? "manual_action_required"
          : post.status === "draft" || post.status === "needs_approval"
            ? "draft"
            : post.status === "scheduled"
              ? "scheduled"
              : known.includes(string(post.status))
                ? "processing"
                : "uncertain";
    let url: string | undefined;
    try {
      const external = new URL(string(post.externalLink));
      if (
        external.protocol === "https:" &&
        !external.username &&
        !external.password
      )
        url = external.toString();
    } catch {
      /* No destination link is available until the provider returns one. */
    }
    return {
      ...previous,
      id,
      status,
      url,
      published_at: published ? new Date(sentAt).toISOString() : undefined,
      due_at: Number.isFinite(Date.parse(string(post.dueAt)))
        ? new Date(string(post.dueAt)).toISOString()
        : undefined,
      buffer_channel_id: account,
      buffer_status: string(post.status),
      buffer_sent_at: string(post.sentAt),
      buffer_scheduling_type: string(post.schedulingType),
      buffer_allowed_actions: strings(post.allowedActions),
      transport: "buffer",
      retry_after: 3600,
    };
  }

  private input(account: string, payload: Payload, draft: boolean) {
    const validation = validatePayload(this.provider, payload);
    const issues = validation.issues.filter(
      (issue) =>
        !(
          this.provider === "tiktok" &&
          payload.media_urls.length > 0 &&
          issue === "validated video required"
        ),
    );
    if (issues.length)
      throw new ProviderError("PACKAGE_INVALID: " + issues.join("; "));
    if (payload.privacy)
      throw new ProviderError("BUFFER_PRIVACY_OVERRIDE_UNSUPPORTED");
    if (payload.media && payload.media_urls.length)
      throw new ProviderError("BUFFER_MIXED_MEDIA_UNSUPPORTED");
    if (payload.media && payload.images?.length)
      throw new ProviderError("BUFFER_MIXED_MEDIA_UNSUPPORTED");
    if (this.provider !== "x" && payload.thread.length)
      throw new ProviderError("BUFFER_THREAD_UNSUPPORTED");
    if (
      this.provider === "x" &&
      (payload.thread.length > 25 || payload.media_urls.length > 4)
    )
      throw new ProviderError("BUFFER_CONTENT_LIMIT");
    // Media limits are documented for each Buffer network. Existing BrainOS
    // validation keeps the stricter H264/MP4, <=50 MB and vertical-video policy.
    // https://support.buffer.com/en-us/articles/instagrams-accepted-aspect-ratio-ranges-Frc2Xqewbd
    // https://support.buffer.com/en-us/articles/using-instagram-with-buffer-YSjg2dXFV8
    // https://support.buffer.com/en-us/articles/using-tiktok-with-buffer-oGEroY9Of2
    // https://support.buffer.com/en-us/articles/using-xtwitter-with-buffer-nA84XnWtuU
    const images = payload.images ?? [];
    if (
      images.length !== payload.media_urls.length ||
      images.some((image, i) => image.url !== payload.media_urls[i])
    )
      throw new ProviderError("BUFFER_IMAGE_METADATA_REQUIRED");
    if (images.length > (this.provider === "x" ? 4 : 10))
      throw new ProviderError("BUFFER_CONTENT_LIMIT");
    for (const image of images) {
      if (
        !image.sha256?.trim() ||
        !Number.isInteger(image.bytes) ||
        image.bytes <= 0 ||
        !Number.isInteger(image.width) ||
        image.width <= 0 ||
        !Number.isInteger(image.height) ||
        image.height <= 0
      )
        throw new ProviderError("BUFFER_IMAGE_METADATA_INVALID");
      const mimes =
        this.provider === "instagram"
          ? ["image/jpeg"]
          : this.provider === "tiktok"
            ? ["image/jpeg", "image/webp"]
            : ["image/jpeg", "image/png", "image/webp"];
      const maxBytes =
        this.provider === "instagram"
          ? 8_000_000
          : this.provider === "tiktok"
            ? 8_000_000
            : 5_000_000;
      if (!mimes.includes(image.mime) || image.bytes > maxBytes)
        throw new ProviderError("BUFFER_IMAGE_FORMAT_LIMIT");
      const ratio = image.width / image.height;
      if (
        this.provider === "instagram" &&
        // Buffer's image/aspect guide allows 3:4, but its video troubleshooting
        // guide still says the API rejects 3:4. Use their shared safe range until
        // live channel configuration confirms the wider range. TikTok's image
        // guide also lists both 8 MB and 20 MB; retain the stricter size.
        // https://support.buffer.com/en-us/articles/troubleshooting-video-uploads-in-buffer-LK0CldlFNB
        // https://support.buffer.com/en-us/articles/ideal-image-sizes-and-formats-for-your-buffer-posts-JxHNGZFvf9
        (ratio < 0.8 || ratio > 1.91 || image.width < 150 || image.height < 150)
      )
        throw new ProviderError("BUFFER_INSTAGRAM_IMAGE_DIMENSIONS");
      if (
        this.provider === "tiktok" &&
        (Math.max(image.width, image.height) > 1920 ||
          Math.min(image.width, image.height) > 1080)
      )
        throw new ProviderError("BUFFER_TIKTOK_IMAGE_DIMENSIONS");
      if (this.provider === "x" && (image.width > 8192 || image.height > 8192))
        throw new ProviderError("BUFFER_X_IMAGE_DIMENSIONS");
    }
    if (
      payload.media &&
      (!payload.media.sha256?.trim() ||
        !Number.isInteger(payload.media.bytes) ||
        !Number.isInteger(payload.media.width) ||
        payload.media.width <= 0 ||
        !Number.isInteger(payload.media.height) ||
        payload.media.height <= 0)
    )
      throw new ProviderError("BUFFER_VIDEO_METADATA_INVALID");
    if (
      this.provider === "tiktok" &&
      payload.media &&
      (payload.media.duration < 3 || payload.media.duration > 600)
    )
      throw new ProviderError("BUFFER_TIKTOK_DURATION_LIMIT");
    if (
      this.provider === "tiktok" &&
      payload.media &&
      (payload.media.width < 360 || payload.media.height < 360)
    )
      throw new ProviderError("BUFFER_TIKTOK_VIDEO_DIMENSIONS");
    if (
      this.provider === "instagram" &&
      payload.media &&
      payload.media.duration < 5
    )
      throw new ProviderError("BUFFER_INSTAGRAM_DURATION_LIMIT");
    if (
      this.provider === "x" &&
      payload.media &&
      (payload.media.duration < 0.5 || payload.media.duration > 140)
    )
      throw new ProviderError("BUFFER_X_DURATION_LIMIT");
    if (
      this.provider === "tiktok" &&
      (payload.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 5
    )
      throw new ProviderError("BUFFER_TIKTOK_HASHTAG_LIMIT");
    const urls = payload.media ? [payload.media.url] : payload.media_urls;
    for (const value of urls) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new ProviderError("STABLE_MEDIA_URL_REQUIRED");
      }
      // The application supplies approved immutable media. Buffer cannot fetch
      // cookies/Authorization headers and explicitly discourages expiring URLs.
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        url.hostname === "localhost" ||
        /^[\d.]+$/.test(url.hostname) ||
        url.hostname.startsWith("[") ||
        /\.(localhost|local|internal)$/i.test(url.hostname) ||
        url.pathname.includes("/storage/v1/object/sign/") ||
        [...url.searchParams.keys()].some((k) =>
          /^(expires|x-amz-expires|x-amz-signature|signature)$/i.test(k),
        )
      )
        throw new ProviderError("STABLE_MEDIA_URL_REQUIRED");
    }
    const assets = payload.media
      ? [{ video: { url: payload.media.url } }]
      : payload.media_urls.map((url) => ({ image: { url } }));
    const mode = draft
      ? "draft"
      : (payload.delivery?.mode ?? (payload.publish_at ? "schedule" : "now"));
    if (!["draft", "schedule", "queue", "now"].includes(mode))
      throw new ProviderError("DELIVERY_MODE_INVALID");
    const scheduledAt = payload.delivery?.scheduled_at ?? payload.publish_at;
    if (
      payload.delivery?.scheduled_at &&
      payload.publish_at &&
      Date.parse(payload.delivery.scheduled_at) !==
        Date.parse(payload.publish_at)
    )
      throw new ProviderError("SCHEDULE_TIME_CONFLICT");
    if (!draft && mode !== "schedule" && scheduledAt !== undefined)
      throw new ProviderError("SCHEDULE_TIME_UNEXPECTED");
    const scheduled = mode === "schedule";
    if (
      scheduled &&
      (!scheduledAt ||
        !Number.isFinite(Date.parse(scheduledAt)) ||
        Date.parse(scheduledAt) <= Date.now())
    )
      throw new ProviderError("SCHEDULE_TIME_INVALID");
    const text =
      this.provider === "x" && payload.thread.length
        ? payload.thread[0]
        : payload.caption;
    const metadata =
      this.provider === "instagram"
        ? {
            instagram: {
              type: payload.media ? "reel" : "post",
              shouldShareToFeed: true,
            },
          }
        : this.provider === "x" && payload.thread.length
          ? {
              twitter: {
                thread: payload.thread.map((text, i) => ({
                  text,
                  assets: i === 0 ? assets : [],
                })),
              },
            }
          : this.provider === "tiktok" && images.length
            ? { tiktok: { title: payload.title } }
            : undefined;
    return {
      channelId: account,
      text,
      schedulingType: "automatic",
      mode:
        mode === "draft" || mode === "queue"
          ? "addToQueue"
          : scheduled
            ? "customScheduled"
            : "shareNow",
      ...(scheduled ? { dueAt: new Date(scheduledAt!).toISOString() } : {}),
      saveToDraft: mode === "draft",
      assets,
      ...(metadata ? { metadata } : {}),
    };
  }

  async publish(
    account: string,
    payload: Payload,
    remote: Remote = {},
    save: (r: Remote) => Promise<void> = async () => {},
  ): Promise<Remote> {
    return this.create(account, payload, remote, save, false);
  }

  async createDraft(
    account: string,
    payload: Payload,
    remote: Remote = {},
    save: (r: Remote) => Promise<void> = async () => {},
  ): Promise<Remote> {
    return this.create(account, payload, remote, save, true);
  }

  private async create(
    account: string,
    payload: Payload,
    remote: Remote,
    save: (r: Remote) => Promise<void>,
    draft: boolean,
  ): Promise<Remote> {
    this.account(account);
    if (!this.writes) throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
    if (remote.id) return this.lookup(account, remote);
    if (
      ["dispatching", "publishing", "uncertain"].includes(remote.status ?? "")
    )
      throw new ProviderError(
        "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION",
        false,
        true,
      );
    const input = this.input(account, payload, draft);
    await this.verifyChannel(account);
    // createPost has no idempotency key. Persist intent before the sole write;
    // after a timeout, a caller must reconcile instead of submitting it again.
    await save({
      ...remote,
      status: "dispatching",
      transport: "buffer",
      buffer_channel_id: account,
    });
    let data: Record<string, unknown>;
    try {
      data = await this.request(
        `mutation BufferCreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { ${postFields} } }
          ... on MutationError { message }
        }
      }`,
        { input },
        true,
      );
    } catch (error) {
      if (error instanceof ProviderError && !error.uncertain)
        await save({
          ...remote,
          status: "not_submitted",
          transport: "buffer",
          buffer_channel_id: account,
        });
      throw error;
    }
    return this.finishWrite(account, data, "createPost", remote, save);
  }

  private async finishWrite(
    account: string,
    data: Record<string, unknown>,
    operation: "createPost" | "editPost",
    previous: Remote,
    save: (r: Remote) => Promise<void>,
  ) {
    const result = object(data[operation]),
      post = object(result.post);
    if (!string(post.id)) {
      const type = string(result.__typename);
      if (
        [
          "UnauthorizedError",
          "NotFoundError",
          "LimitReachedError",
          "InvalidInputError",
        ].includes(type)
      )
        await save({
          ...previous,
          status: operation === "editPost" ? previous.status : "not_submitted",
          transport: "buffer",
          buffer_channel_id: account,
        });
      if (type === "UnauthorizedError")
        throw new ProviderError("INSUFFICIENT_SCOPE");
      if (type === "NotFoundError") throw new ProviderError("REMOTE_NOT_FOUND");
      if (type === "LimitReachedError")
        throw new ProviderError("BUFFER_QUEUE_LIMIT");
      if (type === "InvalidInputError")
        throw new ProviderError("PROVIDER_REJECTED");
      throw new ProviderError("REMOTE_FAILURE", false, true);
    }
    if (previous.id && previous.id !== post.id)
      throw new ProviderError("ACCOUNT_MISMATCH", false, true);
    const checkpoint = {
      ...previous,
      id: string(post.id),
      status: "processing",
      transport: "buffer",
      buffer_channel_id: account,
      buffer_operation: operation,
    };
    try {
      await save(checkpoint);
    } catch {
      throw new ProviderError("CHECKPOINT_FAILED", false, true);
    }
    if (data.partialMutation) {
      const uncertain = { ...checkpoint, status: "uncertain" };
      try {
        await save(uncertain);
      } catch {
        throw new ProviderError("CHECKPOINT_FAILED", false, true);
      }
      return uncertain;
    }
    let next: Remote;
    try {
      next = this.normalize(account, post, checkpoint);
    } catch (error) {
      throw new ProviderError(
        error instanceof ProviderError
          ? error.code
          : "INVALID_PROVIDER_RESPONSE",
        false,
        true,
      );
    }
    next.buffer_operation = undefined;
    try {
      await save(next);
    } catch {
      throw new ProviderError("CHECKPOINT_FAILED", false, true);
    }
    return next;
  }

  async updateDraft(
    account: string,
    remote: Remote,
    payload: Payload,
    save: (r: Remote) => Promise<void> = async () => {},
  ): Promise<Remote> {
    this.account(account);
    if (!this.writes) throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
    if (!remote.id) throw new ProviderError("PUBLICATION_ID_REQUIRED");
    if (
      ["dispatching", "publishing", "uncertain", "cancelling"].includes(
        remote.status ?? "",
      )
    )
      throw new ProviderError(
        "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION",
        false,
        true,
      );
    const current = await this.lookup(account, remote);
    if (
      current.buffer_status !== "draft" ||
      current.buffer_sent_at ||
      !strings(current.buffer_allowed_actions).includes("updatePost")
    )
      throw new ProviderError("BUFFER_DRAFT_EDIT_UNAVAILABLE");
    const draft =
      payload.delivery === undefined && payload.publish_at === undefined;
    const createInput = this.input(account, payload, draft);
    // EditPostInput identifies the existing post; it has no channelId field.
    const { channelId, ...editInput } = createInput;
    if (channelId !== account) throw new ProviderError("ACCOUNT_MISMATCH");
    await this.verifyChannel(account);
    await save({
      ...current,
      status: "dispatching",
      buffer_operation: "editPost",
    });
    let data: Record<string, unknown>;
    try {
      data = await this.request(
        `mutation BufferEditPost($input: EditPostInput!) {
        editPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { ${postFields} } }
          ... on MutationError { message }
        }
      }`,
        { input: { id: remote.id, ...editInput } },
        true,
      );
    } catch (error) {
      if (error instanceof ProviderError && !error.uncertain)
        await save(current);
      throw error;
    }
    return this.finishWrite(account, data, "editPost", current, save);
  }

  async cancel(
    account: string,
    remote: Remote,
    save: (r: Remote) => Promise<void> = async () => {},
  ): Promise<Remote> {
    this.account(account);
    if (!this.writes) throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
    if (!remote.id) throw new ProviderError("PUBLICATION_ID_REQUIRED");
    const current = await this.lookup(account, remote);
    if (current.status === "cancelled") return current;
    // Buffer cannot remove an already published social post. Always recheck the
    // actual post and its allowed action immediately before this unsent deletion.
    // https://support.buffer.com/en-us/articles/scheduling-posts-4Qdld7giAZ
    if (
      !["draft", "needs_approval", "scheduled"].includes(
        string(current.buffer_status),
      ) ||
      current.buffer_sent_at ||
      !strings(current.buffer_allowed_actions).includes("deletePost")
    )
      throw new ProviderError("BUFFER_CANCEL_UNAVAILABLE");
    if (
      remote.buffer_cancel_requested ||
      ["dispatching", "uncertain", "cancelling"].includes(remote.status ?? "")
    )
      throw new ProviderError(
        "UNCERTAIN_WRITE_REQUIRES_RECONCILIATION",
        false,
        true,
      );
    const checkpoint = {
      ...current,
      status: "cancelling",
      buffer_cancel_requested: true,
    };
    await save(checkpoint);
    let data: Record<string, unknown>;
    try {
      data = await this.request(
        `mutation BufferDeletePost($input: DeletePostInput!) {
        deletePost(input: $input) {
          __typename
          ... on DeletePostSuccess { id }
          ... on MutationError { message }
        }
      }`,
        { input: { id: remote.id } },
        true,
      );
    } catch (error) {
      if (error instanceof ProviderError && !error.uncertain)
        await save(current);
      throw error;
    }
    const result = object(data.deletePost);
    if (result.__typename === "VoidMutationError") {
      await save(current);
      throw new ProviderError("PROVIDER_REJECTED");
    }
    if (
      result.__typename !== "DeletePostSuccess" ||
      result.id !== remote.id ||
      data.partialMutation
    )
      throw new ProviderError("REMOTE_FAILURE", false, true);
    const next = {
      ...checkpoint,
      status: "cancelled",
      url: undefined,
      published_at: undefined,
    };
    try {
      await save(next);
    } catch {
      throw new ProviderError("CHECKPOINT_FAILED", false, true);
    }
    return next;
  }

  async lookup(account: string, remote: Remote): Promise<Remote> {
    this.account(account);
    if (remote.buffer_channel_id && remote.buffer_channel_id !== account)
      throw new ProviderError("ACCOUNT_MISMATCH");
    if (!remote.id) return { ...remote, status: "uncertain" };
    let data: Record<string, unknown>;
    try {
      data = await this.request(
        `query BufferPost($input: PostInput!) {
      post(input: $input) { ${postFields} }
    }`,
        { input: { id: remote.id } },
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.code === "REMOTE_NOT_FOUND" &&
        remote.buffer_cancel_requested === true &&
        remote.buffer_channel_id === account
      )
        return {
          ...remote,
          status: "cancelled",
          url: undefined,
          published_at: undefined,
        };
      throw error;
    }
    const next = this.normalize(account, data.post, remote);
    if (
      (remote.buffer_cancel_requested && next.status !== "published") ||
      (remote.buffer_operation === "editPost" &&
        ["dispatching", "uncertain"].includes(remote.status ?? ""))
    )
      next.status = "uncertain";
    return next;
  }

  async metrics(account: string, remote: Remote) {
    this.account(account);
    if (!remote.id) throw new ProviderError("PUBLICATION_ID_REQUIRED");
    const data = await this.request(
      `query BufferPostMetrics($input: PostInput!) {
      post(input: $input) {
        ${postFields}
        metrics { type name value unit }
        metricsUpdatedAt
      }
    }`,
      { input: { id: remote.id } },
    );
    const post = object(data.post);
    if (this.normalize(account, post, remote).status !== "published")
      throw new ProviderError("METRICS_UNAVAILABLE");
    const metrics = rows(post.metrics).filter(
      (m) =>
        typeof m.value === "number" &&
        Number.isFinite(m.value) &&
        m.value >= 0 &&
        string(m.type) &&
        ["count", "percentage"].includes(string(m.unit)),
    );
    if (
      !metrics.length ||
      !Number.isFinite(Date.parse(string(post.metricsUpdatedAt)))
    )
      throw new ProviderError("METRICS_UNAVAILABLE");
    return {
      raw: { metrics: post.metrics, metricsUpdatedAt: post.metricsUpdatedAt },
      values: Object.fromEntries(
        metrics.map((m) => [string(m.type), m.value as number]),
      ),
      semantics: `buffer/${this.provider}/2026-10-02`,
      captured_at: new Date().toISOString(),
    };
  }
}
