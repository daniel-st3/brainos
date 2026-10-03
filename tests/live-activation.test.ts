import { expect, it, vi, afterEach } from "vitest";
import { OfficialClient, type TokenSet } from "../src/providers/client";
import { disconnectProvider } from "../src/providers/auth";
import { sealSecret } from "../src/integrations/google-oauth";
const token: TokenSet = {
  access_token: "fixture-only",
  refresh_token: "refresh-fixture",
  expires_at: Date.now() + 864000000,
  scopes: [],
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllEnvs());
it("beehiiv read capabilities require successful resource checks; reads do not unlock send", async () => {
  const send = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    if (url.endsWith("/publications"))
      return json({ data: [{ id: "pub_fixture", name: "DVNI" }] });
    if (url.includes("expand=stats"))
      return json({ data: { stats: { active_subscriptions: 1 } } });
    if (url.includes("/subscriptions?")) return json({ data: [] });
    return json({ error: { code: "scope_not_authorized" } }, 403);
  });
  vi.stubEnv("BEEHIIV_POSTS_ACCESS_VERIFIED", "false");
  const [identity] = await new OfficialClient(
    "beehiiv",
    token,
    send,
  ).discover();
  expect(identity.capabilities).toEqual([
    "profile_read",
    "analytics",
    "subscriber_read",
  ]);
  expect(identity.blockers).toEqual([
    "BEEHIIV_POSTS_READ_UNAVAILABLE",
    "BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED",
  ]);
  expect(send).toHaveBeenCalledTimes(4);
});
it("YouTube maps handle and scoped capabilities while unaudited publishing stays blocked", async () => {
  vi.stubEnv("YOUTUBE_PROJECT_AUDITED", "false");
  const send = vi.fn(async () =>
    json({
      items: [
        {
          id: "channel_fixture",
          snippet: { title: "DVNI", customUrl: "@dvni_ai" },
        },
      ],
    }),
  );
  const [identity] = await new OfficialClient(
    "youtube",
    {
      ...token,
      scopes: [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
      ],
    },
    send,
  ).discover();
  expect(identity.handle).toBe("dvni_ai");
  expect(identity.capabilities).toEqual([
    "profile_read",
    "media_upload",
    "analytics",
  ]);
  expect(identity.blockers).toEqual(["YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY"]);
});
it("disconnecting YouTube using the shared Google client removes only its local token and preserves Drive", async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("GOOGLE_CLIENT_ID", "shared-client");
  vi.stubEnv("YOUTUBE_CLIENT_ID", "shared-client");
  const account = {
    id: "fixture-account",
    kind: "account",
    version: 1,
    is_demo: false,
    data: {
      platform: "youtube",
      status: "connected",
      external_id: "fixture-channel",
    },
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === "read_control")
      return { epoch: 1, entities: [account], jobs: [] };
    if (name === "provider_secret")
      return sealSecret(JSON.stringify(token), "provider:" + account.id);
    if (name === "disconnect_provider") return null;
    throw Error("Unexpected RPC");
  });
  const send = vi.fn(async () => {
    throw Error("Remote revoke would invalidate Drive");
  });
  await disconnectProvider(rpc, account.id, "editor", send);
  expect(send).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith(
    "disconnect_provider",
    expect.objectContaining({
      p_entity: expect.objectContaining({
        data: expect.objectContaining({
          status: "revoked",
          writes_authorized: false,
          external_id: null,
          reason: expect.stringContaining(
            "Shared Google authorization preserved",
          ),
        }),
      }),
    }),
  );
});
