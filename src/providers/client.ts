import type { Provider } from "../control/model";
import { appConfig, definitions, providerVersion } from "./definitions";
import { validatePayload } from "./validation";
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scopes: string[];
  account_id?: string;
}
export interface Identity {
  id: string;
  handle: string;
  name: string;
  bio: string;
  capabilities: string[];
  blockers: string[];
  raw: Record<string, unknown>;
}
export interface Payload {
  title: string;
  caption: string;
  thread: string[];
  source_links: string[];
  media_urls: string[];
  media?: {
    url: string;
    bytes: number;
    mime: string;
    duration: number;
    width: number;
    height: number;
    codec: string;
    sha256: string;
  };
  privacy?: string;
  publish_at?: string;
}
export interface Remote {
  id?: string;
  url?: string;
  status?: string;
  ids?: string[];
  upload_url?: string;
  next_index?: number;
  [key: string]: unknown;
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public uncertain = false,
    public retryAfter = 3600,
  ) {
    super(code);
  }
}
export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
const obj = (v: unknown) =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
export class OfficialClient {
  constructor(
    public provider: Provider,
    public tokens: TokenSet,
    private send: Transport = fetch,
    private writes = false,
  ) {}
  private paid() {
    if (this.provider === "x" && process.env.BRAINOS_ALLOW_PAID_X !== "true")
      throw new ProviderError("PAID_API_ACCESS_REQUIRED");
  }
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    base = definitions[this.provider].api,
    extra: Record<string, string> = {},
  ) {
    if (!this.tokens.access_token) throw new ProviderError("AUTH_REQUIRED");
    this.paid();
    if (this.tokens.expires_at <= Date.now())
      throw new ProviderError("TOKEN_EXPIRED");
    const url = base + path;
    let response: Response;
    try {
      response = await this.send(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.tokens.access_token}`,
          "Content-Type": "application/json",
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      });
    } catch {
      throw new ProviderError(
        "NETWORK_FAILURE",
        method === "GET",
        method !== "GET",
      );
    }
    const r = obj(await response.json().catch(() => ({}))),
      e = obj(r.error);
    if (!response.ok || (e.code && e.code !== "ok")) {
      const status = response.status,
        code = str(e.code);
      throw new ProviderError(
        status === 429 || code === "rate_limit_exceeded"
          ? "RATE_LIMIT"
          : status === 401 || code === "access_token_invalid"
            ? "TOKEN_EXPIRED"
            : status === 403 || code === "scope_not_authorized"
              ? "INSUFFICIENT_SCOPE"
              : status >= 500
                ? "REMOTE_FAILURE"
                : "PROVIDER_REJECTED",
        status === 429 || status >= 500,
        method !== "GET" && status >= 500,
        Math.max(60, Number(response.headers.get("retry-after")) || 3600),
      );
    }
    return r;
  }
  private write() {
    if (!this.writes) throw new ProviderError("EXTERNAL_PUBLISHING_DISABLED");
    this.paid();
    if (!this.tokens.access_token) throw new ProviderError("AUTH_REQUIRED");
    if (this.tokens.expires_at <= Date.now())
      throw new ProviderError("TOKEN_EXPIRED");
  }
  async discover(): Promise<Identity[]> {
    const p = this.provider;
    let rows: Record<string, unknown>[] = [];
    if (p === "instagram")
      rows = [
        await this.request(
          "/me?fields=user_id,username,name,account_type,biography",
        ),
      ];
    if (p === "tiktok") {
      const r = await this.request(
        "/user/info/?fields=open_id,display_name,username,bio_description",
      );
      rows = [obj(obj(r.data).user)];
    }
    if (p === "x") {
      const r = await this.request(
        "/users/me?user.fields=description,username,name",
      );
      rows = [obj(r.data)];
    }
    if (p === "youtube") {
      const r = await this.request("/channels?part=id,snippet&mine=true");
      rows = list(r.items);
    }
    if (p === "beehiiv") {
      const r = await this.request("/publications");
      rows = list(r.data);
    }
    return rows.map((r) => {
      const sn = obj(r.snippet),
        id = str(r.user_id || r.open_id || r.id),
        blocks: string[] = [];
      const capabilities = ["profile_read"];
      const has = (scope: string) => this.tokens.scopes.includes(scope);
      if (!id) throw new ProviderError("ACCOUNT_ID_MISSING");
      if (p === "instagram") {
        if (!["BUSINESS", "MEDIA_CREATOR"].includes(str(r.account_type)))
          blocks.push("PROFESSIONAL_ACCOUNT_REQUIRED");
        else {
          if (has("instagram_business_content_publish"))
            capabilities.push("publish", "media_upload", "schedule");
          if (has("instagram_business_manage_insights"))
            capabilities.push("analytics");
        }
      }
      if (p === "tiktok") {
        if (has("video.publish")) capabilities.push("media_upload");
        if (has("video.list")) capabilities.push("analytics");
        if (process.env.TIKTOK_APP_AUDITED === "true" && has("video.publish"))
          capabilities.push("publish", "schedule");
        else blocks.push("TIKTOK_APP_AUDIT_AND_CREATOR_PRIVACY_REQUIRED");
      }
      if (p === "x") {
        if (has("tweet.write")) capabilities.push("publish", "schedule");
        if (has("tweet.read")) capabilities.push("analytics");
        if (has("media.write")) capabilities.push("media_upload");
      }
      if (p === "youtube") {
        if (has("https://www.googleapis.com/auth/youtube.upload"))
          capabilities.push("media_upload");
        if (
          process.env.YOUTUBE_PROJECT_AUDITED === "true" &&
          has("https://www.googleapis.com/auth/youtube.upload")
        )
          capabilities.push("publish", "schedule");
        else blocks.push("YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY");
        if (has("https://www.googleapis.com/auth/yt-analytics.readonly"))
          capabilities.push("analytics");
      }
      if (p === "beehiiv") {
        capabilities.push("analytics");
        if (process.env.BEEHIIV_POSTS_ACCESS_VERIFIED === "true")
          capabilities.push("publish", "schedule");
        else blocks.push("BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED");
      }
      return {
        id,
        handle: str(r.username || sn.customUrl || r.name),
        name: str(r.name || r.display_name || sn.title),
        bio: str(
          r.biography || r.bio_description || r.description || sn.description,
        ),
        capabilities,
        blockers: blocks,
        raw: r,
      };
    });
  }
  async creatorInfo() {
    return obj(
      (await this.request("/post/publish/creator_info/query/", "POST", {}))
        .data,
    );
  }
  async publish(
    account: string,
    payload: Payload,
    remote: Remote = {},
    save: (r: Remote) => Promise<void> = async () => {},
  ): Promise<Remote> {
    this.write();
    const validation = validatePayload(this.provider, payload);
    if (!validation.valid)
      throw new ProviderError(
        "PACKAGE_INVALID: " + validation.issues.join("; "),
      );
    const p = this.provider;
    if (p === "instagram") {
      let id = remote.id;
      if (!id) {
        const children: string[] = [];
        if (payload.media_urls.length > 1) {
          for (const url of payload.media_urls) {
            const r = await this.request(`/${account}/media`, "POST", {
              image_url: url,
              is_carousel_item: true,
            });
            children.push(str(r.id));
          }
        }
        const body = children.length
          ? {
              media_type: "CAROUSEL",
              children: children.join(","),
              caption: payload.caption,
            }
          : payload.media
            ? {
                media_type: "REELS",
                video_url: payload.media.url,
                caption: payload.caption,
                share_to_feed: true,
              }
            : { image_url: payload.media_urls[0], caption: payload.caption };
        const r = await this.request(`/${account}/media`, "POST", body);
        id = str(r.id);
        if (!id) throw new ProviderError("REMOTE_ID_MISSING", false, true);
        remote = { id, status: "processing", children };
        await save(remote);
      }
      const status = await this.request(`/${id}?fields=status_code,status`);
      if (status.status_code !== "FINISHED")
        return {
          id,
          status:
            status.status_code === "ERROR" || status.status_code === "EXPIRED"
              ? "rejected"
              : "processing",
        };
      await save({ ...remote, status: "publishing" });
      const r = await this.request(`/${account}/media_publish`, "POST", {
        creation_id: id,
      });
      await save({ id: str(r.id), status: "published" });
      const result = await this.request(`/${str(r.id)}?fields=id,permalink`);
      return {
        id: str(result.id),
        url: str(result.permalink),
        status: "published",
      };
    }
    if (p === "tiktok") {
      if (remote.id) return this.lookup(account, remote);
      const creator = await this.creatorInfo(),
        privacy = payload.privacy;
      if (
        !privacy ||
        !Array.isArray(creator.privacy_level_options) ||
        !creator.privacy_level_options.includes(privacy)
      )
        throw new ProviderError("CREATOR_PRIVACY_CHOICE_REQUIRED");
      if (
        !payload.media ||
        payload.media.duration > Number(creator.max_video_post_duration_sec)
      )
        throw new ProviderError("CREATOR_DURATION_LIMIT");
      const r = await this.request("/post/publish/video/init/", "POST", {
          post_info: {
            title: payload.caption,
            privacy_level: privacy,
            disable_duet: true,
            disable_stitch: true,
            disable_comment: true,
            brand_content_toggle: false,
            brand_organic_toggle: false,
            is_aigc: false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: payload.media.bytes,
            chunk_size: payload.media.bytes,
            total_chunk_count: 1,
          },
        }),
        d = obj(r.data);
      if (!d.publish_id || !d.upload_url)
        throw new ProviderError("UPLOAD_SESSION_FAILED", false, true);
      const upload = new URL(str(d.upload_url)),
        source = new URL(payload.media.url);
      if (
        upload.protocol !== "https:" ||
        !upload.hostname.endsWith(".tiktokapis.com") ||
        !upload.pathname.startsWith("/video/") ||
        source.protocol !== "https:" ||
        !source.hostname.endsWith(".supabase.co")
      )
        throw new ProviderError("INVALID_UPLOAD_SESSION");
      await save({
        id: str(d.publish_id),
        status: "upload_pending",
        upload_url: upload.toString(),
      });
      const download = await this.send(source.toString(), {
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!download.ok || !download.body)
        throw new ProviderError("MEDIA_UNAVAILABLE");
      const init: RequestInit & { duplex: string } = {
        method: "PUT",
        duplex: "half",
        headers: {
          "Content-Type": payload.media.mime,
          "Content-Length": String(payload.media.bytes),
          "Content-Range": `bytes 0-${payload.media.bytes - 1}/${payload.media.bytes}`,
        },
        body: download.body,
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      };
      let response: Response;
      try {
        response = await this.send(upload.toString(), init);
      } catch {
        throw new ProviderError("UPLOAD_INTERRUPTED", false, true);
      }
      if (response.status !== 201)
        throw new ProviderError("UPLOAD_NOT_COMPLETE", false, true);
      await save({ id: str(d.publish_id), status: "processing" });
      return { id: str(d.publish_id), status: "processing" };
    }
    if (p === "x") {
      const texts = payload.thread.length ? payload.thread : [payload.caption],
        ids = remote.ids ?? [];
      if ((payload.media || payload.media_urls.length) && !remote.media_id) {
        const url = new URL(payload.media?.url ?? payload.media_urls[0]);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co"))
          throw new ProviderError("TRUSTED_MEDIA_REQUIRED");
        const r = await this.send(url.toString(), {
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        if (!r.ok) throw new ProviderError("MEDIA_UNAVAILABLE");
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > 50000000) throw new ProviderError("MEDIA_TOO_LARGE");
        const uploaded = await this.uploadX(
          bytes,
          payload.media?.mime ?? "image/png",
        );
        remote = {
          ...remote,
          media_id: uploaded.id,
          status: "media_processing",
        };
        await save(remote);
      }
      if (remote.media_id) {
        const r = await this.request(
          `/media/upload?media_id=${encodeURIComponent(String(remote.media_id))}`,
        );
        const info = obj(obj(r.data).processing_info);
        if (info.state === "failed")
          throw new ProviderError("MEDIA_PROCESSING_FAILED");
        if (info.state && info.state !== "succeeded")
          return { ...remote, status: "media_processing" };
      }
      for (let i = ids.length; i < texts.length; i++) {
        await save({ ids: [...ids], next_index: i, status: "dispatching" });
        const r = await this.request("/tweets", "POST", {
          text: texts[i],
          ...(ids.length
            ? { reply: { in_reply_to_tweet_id: ids.at(-1) } }
            : {}),
          ...(i === 0 && remote.media_id
            ? { media: { media_ids: [remote.media_id] } }
            : {}),
        });
        const id = str(obj(r.data).id);
        if (!id) throw new ProviderError("REMOTE_ID_MISSING", false, true);
        ids.push(id);
        await save({ ids: [...ids], next_index: i + 1, status: "processing" });
      }
      return {
        id: ids[0],
        ids,
        status: "published",
        url: `https://x.com/i/status/${ids[0]}`,
      };
    }
    if (p === "youtube") {
      if (remote.id) return this.lookup(account, remote);
      if (!payload.media) throw new ProviderError("VIDEO_REQUIRED");
      if (!remote.upload_url) {
        const response = await this.send(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.tokens.access_token}`,
              "Content-Type": "application/json",
              "X-Upload-Content-Type": payload.media.mime,
              "X-Upload-Content-Length": String(payload.media.bytes),
            },
            body: JSON.stringify({
              snippet: {
                title: payload.title,
                description: payload.caption,
                defaultLanguage: "es",
              },
              status: {
                privacyStatus: payload.publish_at
                  ? "private"
                  : (payload.privacy ?? "private"),
                selfDeclaredMadeForKids: false,
                ...(payload.publish_at
                  ? { publishAt: payload.publish_at }
                  : {}),
              },
            }),
            signal: AbortSignal.timeout(25000),
            redirect: "error",
          },
        );
        if (!response.ok || !response.headers.get("location"))
          throw new ProviderError("UPLOAD_SESSION_FAILED", false, true);
        remote = {
          status: "upload_pending",
          upload_url: response.headers.get("location")!,
        };
        await save(remote);
      }
      const upload = new URL(remote.upload_url!);
      if (
        upload.origin !== "https://www.googleapis.com" ||
        !upload.pathname.startsWith("/upload/youtube/")
      )
        throw new ProviderError("INVALID_UPLOAD_SESSION");
      const probe = await this.send(upload.toString(), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.tokens.access_token}`,
          "Content-Range": `bytes */${payload.media.bytes}`,
          "Content-Length": "0",
        },
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      });
      if (probe.ok) {
        const r = (await probe.json()) as { id: string };
        return {
          id: r.id,
          status: "processing",
          url: `https://www.youtube.com/watch?v=${r.id}`,
        };
      }
      if (probe.status !== 308)
        throw new ProviderError("UPLOAD_SESSION_INVALID", false, true);
      const offset =
        Number(probe.headers.get("range")?.match(/-(\d+)$/)?.[1] ?? -1) + 1;
      const source = new URL(payload.media.url);
      if (
        source.protocol !== "https:" ||
        !source.hostname.endsWith(".supabase.co")
      )
        throw new ProviderError("TRUSTED_MEDIA_REQUIRED");
      const download = await this.send(source.toString(), {
        headers: offset ? { Range: `bytes=${offset}-` } : {},
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      });
      if (!download.ok || !download.body)
        throw new ProviderError("MEDIA_UNAVAILABLE");
      const init: RequestInit & { duplex: string } = {
        method: "PUT",
        duplex: "half",
        headers: {
          Authorization: `Bearer ${this.tokens.access_token}`,
          "Content-Type": payload.media.mime,
          "Content-Length": String(payload.media.bytes - offset),
          "Content-Range": `bytes ${offset}-${payload.media.bytes - 1}/${payload.media.bytes}`,
        },
        body: download.body,
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      };
      const response = await this.send(upload.toString(), init);
      if (!response.ok)
        throw new ProviderError("UPLOAD_INTERRUPTED", false, true);
      const result = (await response.json()) as { id: string };
      await save({ id: result.id, status: "processing" });
      if (payload.media_urls[0])
        await this.setThumbnail(result.id, payload.media_urls[0]);
      return {
        id: result.id,
        status: "processing",
        url: `https://www.youtube.com/watch?v=${result.id}`,
      };
    }
    const r = await this.request(`/publications/${account}/posts`, "POST", {
        title: payload.title,
        body_content: payload.caption,
        status: "confirmed",
        ...(payload.publish_at ? { scheduled_at: payload.publish_at } : {}),
      }),
      d = obj(r.data);
    return { id: str(d.id), url: str(d.web_url), status: "processing" };
  }
  async setThumbnail(videoId: string, sourceUrl: string) {
    this.write();
    if (this.provider !== "youtube")
      throw new ProviderError("UNSUPPORTED_CAPABILITY");
    const source = new URL(sourceUrl);
    if (
      source.protocol !== "https:" ||
      !source.hostname.endsWith(".supabase.co")
    )
      throw new ProviderError("TRUSTED_MEDIA_REQUIRED");
    const r = await this.send(sourceUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new ProviderError("MEDIA_UNAVAILABLE");
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > 2000000)
      throw new ProviderError("THUMBNAIL_TOO_LARGE");
    const response = await this.send(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.tokens.access_token}`,
          "Content-Type": r.headers.get("content-type") ?? "image/png",
        },
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!response.ok)
      throw new ProviderError("THUMBNAIL_CAPABILITY_UNAVAILABLE");
    return response.json();
  }
  async uploadX(bytes: Uint8Array, mime: string) {
    this.write();
    const init = await this.request("/media/upload/initialize", "POST", {
      media_type: mime,
      total_bytes: bytes.byteLength,
      media_category: mime.startsWith("video") ? "tweet_video" : "tweet_image",
    });
    const id = str(obj(init.data).id);
    for (
      let n = 0, offset = 0;
      offset < bytes.byteLength;
      n++, offset += 4_000_000
    ) {
      const form = new FormData();
      form.set("segment_index", String(n));
      form.set(
        "media",
        new Blob([Uint8Array.from(bytes.slice(offset, offset + 4_000_000))]),
      );
      const r = await this.send(
        definitions.x.api + `/media/upload/${id}/append`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.tokens.access_token}` },
          body: form,
          signal: AbortSignal.timeout(25000),
        },
      );
      if (!r.ok) throw new ProviderError("MEDIA_APPEND_FAILED", false, true);
    }
    if (!id) throw new ProviderError("REMOTE_ID_MISSING", false, true);
    const result = await this.request(
      `/media/upload/${id}/finalize`,
      "POST",
      {},
    );
    return { ...obj(result.data), id };
  }
  async lookup(account: string, remote: Remote): Promise<Remote> {
    if (
      this.provider === "x" &&
      remote.media_id &&
      remote.status === "media_processing"
    )
      return { ...remote, status: "container_ready" };
    if (!remote.id)
      return {
        ...remote,
        status:
          remote.status === "dispatching"
            ? "uncertain"
            : (remote.status ?? "uncertain"),
      };
    const id = encodeURIComponent(remote.id),
      p = this.provider;
    if (p === "instagram") {
      const r = await this.request(`/${id}?fields=id,permalink,status_code`);
      return {
        ...remote,
        status: r.permalink
          ? "published"
          : r.status_code === "FINISHED"
            ? "container_ready"
            : r.status_code === "ERROR"
              ? "rejected"
              : "processing",
        url: str(r.permalink) || undefined,
      };
    }
    if (p === "tiktok") {
      const r = obj(
          (
            await this.request("/post/publish/status/fetch/", "POST", {
              publish_id: remote.id,
            })
          ).data,
        ),
        ids = Array.isArray(r.publicaly_available_post_id)
          ? r.publicaly_available_post_id.map(str)
          : [];
      let share: string | undefined;
      if (ids.length && this.tokens.scopes.includes("video.list")) {
        const v = await this.request(
          "/video/query/?fields=id,share_url",
          "POST",
          { filters: { video_ids: ids } },
        );
        share = str(list(obj(v.data).videos)[0]?.share_url) || undefined;
      }
      return {
        ...remote,
        status:
          r.status === "PUBLISH_COMPLETE"
            ? "published"
            : r.status === "FAILED"
              ? "rejected"
              : "processing",
        ids,
        url: share,
      };
    }
    if (p === "x") {
      await this.request(`/tweets/${id}`);
      return {
        ...remote,
        status: "published",
        url: `https://x.com/i/status/${id}`,
      };
    }
    if (p === "youtube") {
      const r = await this.request(
          `/videos?part=status,processingDetails&id=${id}`,
        ),
        v = list(r.items)[0];
      if (!v) throw new ProviderError("PUBLICATION_NOT_FOUND");
      return {
        ...remote,
        status:
          obj(v.status).uploadStatus === "processed" &&
          ["public", "unlisted"].includes(str(obj(v.status).privacyStatus))
            ? "published"
            : obj(v.status).uploadStatus === "processed"
              ? "private_review_required"
              : "processing",
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    }
    const r = obj(
      (await this.request(`/publications/${account}/posts/${id}`)).data,
    );
    return {
      ...remote,
      status:
        r.status === "confirmed" ? "published" : str(r.status) || "processing",
      url: str(r.web_url) || undefined,
    };
  }
  async metrics(account: string, remote: Remote) {
    if (!remote.id) throw new ProviderError("PUBLICATION_ID_REQUIRED");
    const p = this.provider,
      id = encodeURIComponent(remote.id);
    let raw: Record<string, unknown>,
      values: Record<string, number> = {};
    if (p === "instagram") {
      raw = await this.request(
        `/${id}/insights?metric=views,reach,likes,comments,saved,shares`,
      );
      for (const r of list(raw.data)) {
        const v = list(r.values)[0]?.value ?? obj(r.total_value).value;
        if (typeof v === "number") values[str(r.name)] = v;
      }
    } else if (p === "tiktok") {
      raw = await this.request(
        "/video/query/?fields=id,view_count,like_count,comment_count,share_count",
        "POST",
        {
          filters: { video_ids: remote.ids?.length ? remote.ids : [remote.id] },
        },
      );
      const v = list(obj(raw.data).videos)[0] ?? {};
      for (const name of [
        "view_count",
        "like_count",
        "comment_count",
        "share_count",
      ])
        if (typeof v[name] === "number") values[name] = v[name] as number;
    } else if (p === "x") {
      raw = await this.request(
        `/tweets/${id}?tweet.fields=public_metrics,non_public_metrics,organic_metrics`,
      );
      values = {
        ...obj(obj(raw.data).public_metrics),
        ...obj(obj(raw.data).non_public_metrics),
        ...obj(obj(raw.data).organic_metrics),
      } as Record<string, number>;
    } else if (p === "youtube") {
      const today = new Date().toISOString().slice(0, 10);
      raw = await this.request(
        `?ids=channel==${encodeURIComponent(account)}&startDate=2020-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained&filters=video==${id}`,
        "GET",
        undefined,
        "https://youtubeanalytics.googleapis.com/v2/reports",
      );
      const cols = list(raw.columnHeaders),
        rows =
          Array.isArray(raw.rows) && Array.isArray(raw.rows[0])
            ? (raw.rows[0] as unknown[])
            : [];
      cols.forEach((c, i) => {
        if (typeof rows[i] === "number")
          values[str(c.name)] = rows[i] as number;
      });
    } else {
      raw = await this.request(
        `/publications/${account}/posts/${id}?expand=stats`,
      );
      const stats = obj(obj(raw.data).stats);
      const visit = (r: Record<string, unknown>, prefix = "") => {
        for (const [k, v] of Object.entries(r)) {
          const name = prefix ? `${prefix}.${k}` : k;
          if (typeof v === "number") values[name] = v;
          else if (v && typeof v === "object" && !Array.isArray(v))
            visit(obj(v), name);
        }
      };
      visit(stats);
    }
    return {
      raw,
      values: Object.fromEntries(
        Object.entries(values).filter(
          ([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0,
        ),
      ),
      semantics: `${p}/${providerVersion}`,
      captured_at: new Date().toISOString(),
    };
  }
  async newsletterDraft(account: string, p: Payload, id?: string) {
    this.write();
    if (this.provider !== "beehiiv")
      throw new ProviderError("UNSUPPORTED_CAPABILITY");
    return this.request(
      `/publications/${account}/posts${id ? `/${id}` : ""}`,
      id ? "PATCH" : "POST",
      { title: p.title, body_content: p.caption, status: "draft" },
    );
  }
  async syncSubscriber(
    account: string,
    email: string,
    active: boolean,
    remoteId?: string,
  ) {
    this.write();
    if (this.provider !== "beehiiv")
      throw new ProviderError("UNSUPPORTED_CAPABILITY");
    if (!active) {
      const id =
        remoteId ||
        str(
          obj(
            (
              await this.request(
                `/publications/${account}/subscriptions/by_email/${encodeURIComponent(email)}`,
              )
            ).data,
          ).id,
        );
      if (!id) throw new ProviderError("SUBSCRIBER_NOT_FOUND");
      return this.request(
        `/publications/${account}/subscriptions/${encodeURIComponent(id)}`,
        "PATCH",
        { unsubscribe: true },
      );
    }
    return this.request(`/publications/${account}/subscriptions`, "POST", {
      email,
      reactivate_existing: false,
      send_welcome_email: false,
    });
  }
  async revoke() {
    const p = this.provider;
    let response: Response | undefined;
    if (p === "youtube") {
      response = await this.send("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: this.tokens.refresh_token ?? this.tokens.access_token,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } else if (p === "tiktok") {
      const c = appConfig(p);
      response = await this.send(
        "https://open.tiktokapis.com/v2/oauth/revoke/",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: c.clientId,
            client_secret: c.clientSecret,
            token: this.tokens.access_token,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } else if (p === "instagram")
      await this.request("/me/permissions", "DELETE");
    else if (p === "x") {
      const c = appConfig(p);
      response = await this.send("https://api.x.com/2/oauth2/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          token: this.tokens.access_token,
          client_id: c.clientId,
        }),
        signal: AbortSignal.timeout(15000),
      });
    }
    if (response) {
      const result = obj(await response.json().catch(() => ({}))),
        error = obj(result.error);
      if (!response.ok || (error.code && error.code !== "ok"))
        throw new ProviderError("REMOTE_REVOCATION_FAILED");
    }
  }
}
