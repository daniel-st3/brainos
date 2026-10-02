import { afterEach, expect, it, vi } from "vitest";
import type { Account, Provider } from "../src/control/model";
import { resolveDistributionAdapter } from "../src/providers/routing";

afterEach(() => vi.unstubAllEnvs());
function account(
  platform: Provider,
  overrides: Partial<Account> = {},
): Account {
  return {
    platform,
    status: "connected",
    external_id: "selected-account",
    handle: "demo-fixture",
    capabilities: ["profile_read", "publish"],
    verified_at: "2026-10-02T12:00:00Z",
    reason: null,
    ...overrides,
  };
}

for (const platform of ["instagram", "tiktok", "x"] as const)
  it(`${platform}: routes a verified Buffer channel without requiring direct-app access`, () => {
    vi.stubEnv("BRAINOS_ALLOW_PAID_X", "false");
    vi.stubEnv("TIKTOK_APP_AUDITED", "false");
    vi.stubEnv("TIKTOK_VERIFIED_MEDIA_PREFIX", "");
    const selected = account(platform, {
      delivery_transport: "buffer",
      external_id: "selected-buffer-channel",
    });
    const before = structuredClone(selected);
    expect(resolveDistributionAdapter({ platform }, selected)).toEqual({
      adapter: "buffer",
      transport: "buffer",
      platform,
      account_external_id: "selected-buffer-channel",
      verified_at: selected.verified_at,
    });
    expect(selected).toEqual(before);
  });

it("preserves a verified native Instagram account when no Buffer connection is configured", () => {
  expect(
    resolveDistributionAdapter({ platform: "instagram" }, account("instagram")),
  ).toMatchObject({
    adapter: "instagram_direct",
    transport: "native",
    account_external_id: "selected-account",
  });
});

it("requires explicit native X cost authorization, even when its publish capability is cached", () => {
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "false");
  expect(() =>
    resolveDistributionAdapter({ platform: "x" }, account("x")),
  ).toThrow("PAID_API_ACCESS_REQUIRED");
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
  expect(
    resolveDistributionAdapter({ platform: "x" }, account("x")),
  ).toMatchObject({ adapter: "x_direct", transport: "native" });
});

it("requires native TikTok review and a valid verified HTTPS media prefix", () => {
  const selected = account("tiktok", { delivery_transport: "native" });
  vi.stubEnv("TIKTOK_APP_AUDITED", "false");
  expect(() =>
    resolveDistributionAdapter({ platform: "tiktok" }, selected),
  ).toThrow("TIKTOK_APP_AUDIT_REQUIRED");
  vi.stubEnv("TIKTOK_APP_AUDITED", "true");
  for (const prefix of [
    "",
    "http://media.example.invalid/",
    "https://media.example.invalid/path",
    "https://media.example.invalid/?secret=fixture",
    "https://user:secret@media.example.invalid/",
  ]) {
    vi.stubEnv("TIKTOK_VERIFIED_MEDIA_PREFIX", prefix);
    expect(() =>
      resolveDistributionAdapter({ platform: "tiktok" }, selected),
    ).toThrow("VERIFIED_MEDIA_URL_REQUIRED");
  }
  vi.stubEnv(
    "TIKTOK_VERIFIED_MEDIA_PREFIX",
    "https://media.example.invalid/approved/",
  );
  expect(
    resolveDistributionAdapter({ platform: "tiktok" }, selected),
  ).toMatchObject({ adapter: "tiktok_direct", transport: "native" });
});

it("keeps YouTube and beehiiv on their verified native adapters and access gates", () => {
  vi.stubEnv("YOUTUBE_PROJECT_AUDITED", "false");
  expect(() =>
    resolveDistributionAdapter({ platform: "youtube" }, account("youtube")),
  ).toThrow("YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY");
  vi.stubEnv("YOUTUBE_PROJECT_AUDITED", "true");
  expect(
    resolveDistributionAdapter({ platform: "youtube" }, account("youtube")),
  ).toMatchObject({ adapter: "youtube_direct" });
  vi.stubEnv("BEEHIIV_POSTS_ACCESS_VERIFIED", "false");
  expect(() =>
    resolveDistributionAdapter({ platform: "beehiiv" }, account("beehiiv")),
  ).toThrow("BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED");
  vi.stubEnv("BEEHIIV_POSTS_ACCESS_VERIFIED", "true");
  expect(
    resolveDistributionAdapter({ platform: "beehiiv" }, account("beehiiv")),
  ).toMatchObject({ adapter: "beehiiv" });
});

it("never falls back from an unverified Buffer selection to a native account", () => {
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "true");
  for (const [change, blocker] of [
    [{ status: "degraded" }, "AUTH_REQUIRED"],
    [{ external_id: null }, "ACCOUNT_ID_MISSING"],
    [{ verified_at: null }, "ACCOUNT_VERIFICATION_REQUIRED"],
    [{ verified_at: "not-a-date" }, "ACCOUNT_VERIFICATION_REQUIRED"],
    [{ capabilities: ["profile_read"] }, "PUBLISH_CAPABILITY_UNAVAILABLE"],
  ] as const) {
    const selected = account("x", {
      delivery_transport: "buffer",
      ...change,
      capabilities:
        "capabilities" in change ? [...change.capabilities] : ["publish"],
    });
    expect(() =>
      resolveDistributionAdapter({ platform: "x" }, selected),
    ).toThrow(blocker);
    expect(selected.delivery_transport).toBe("buffer");
  }
});

it("rejects platform mismatch, unsupported Buffer platforms, and unknown transport without guessing", () => {
  expect(() =>
    resolveDistributionAdapter({ platform: "instagram" }, account("x")),
  ).toThrow("ACCOUNT_PLATFORM_MISMATCH");
  for (const platform of ["youtube", "beehiiv"] as const)
    expect(() =>
      resolveDistributionAdapter(
        { platform },
        account(platform, { delivery_transport: "buffer" }),
      ),
    ).toThrow("BUFFER_PLATFORM_UNSUPPORTED");
  const invalid = {
    ...account("instagram"),
    delivery_transport: "unknown",
  } as unknown as Account;
  expect(() =>
    resolveDistributionAdapter({ platform: "instagram" }, invalid),
  ).toThrow("UNSUPPORTED_DELIVERY_TRANSPORT");
});
