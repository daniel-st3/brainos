import type { Account, Package, Provider } from "../control/model";
import { ProviderError } from "./client";

export type DistributionAdapterId =
  | "buffer"
  | "instagram_direct"
  | "tiktok_direct"
  | "x_direct"
  | "youtube_direct"
  | "beehiiv";

export interface ResolvedDistributionAdapter {
  adapter: DistributionAdapterId;
  transport: "buffer" | "native";
  platform: Provider;
  account_external_id: string;
  verified_at: string;
}

const nativeAdapters: Record<Provider, DistributionAdapterId> = {
  instagram: "instagram_direct",
  tiktok: "tiktok_direct",
  x: "x_direct",
  youtube: "youtube_direct",
  beehiiv: "beehiiv",
};

function verifiedTikTokMediaPrefix() {
  try {
    const prefix = new URL(process.env.TIKTOK_VERIFIED_MEDIA_PREFIX ?? "");
    return (
      prefix.protocol === "https:" &&
      !prefix.username &&
      !prefix.password &&
      !prefix.search &&
      !prefix.hash &&
      prefix.pathname.endsWith("/")
    );
  } catch {
    return false;
  }
}

/** Resolve only the selected account's verified connection. Credentials are checked at dispatch. */
export function resolveDistributionAdapter(
  contentPackage: Pick<Package, "platform">,
  platformAccount: Account,
): ResolvedDistributionAdapter {
  if (contentPackage.platform !== platformAccount.platform)
    throw new ProviderError("ACCOUNT_PLATFORM_MISMATCH");
  if (platformAccount.status !== "connected")
    throw new ProviderError("AUTH_REQUIRED");
  if (!platformAccount.external_id?.trim())
    throw new ProviderError("ACCOUNT_ID_MISSING");
  if (
    !platformAccount.verified_at ||
    !Number.isFinite(Date.parse(platformAccount.verified_at))
  )
    throw new ProviderError("ACCOUNT_VERIFICATION_REQUIRED");
  if (!platformAccount.capabilities.includes("publish"))
    throw new ProviderError("PUBLISH_CAPABILITY_UNAVAILABLE");

  // There is one credential slot per account. A configured Buffer channel never
  // falls back to native credentials (or a different external account) on failure.
  const transport = platformAccount.delivery_transport ?? "native";
  const platform = contentPackage.platform;
  let adapter: DistributionAdapterId;
  if (transport === "buffer") {
    if (!["instagram", "tiktok", "x"].includes(platform))
      throw new ProviderError("BUFFER_PLATFORM_UNSUPPORTED");
    adapter = "buffer";
  } else if (transport === "native") {
    if (platform === "x" && process.env.BRAINOS_ALLOW_PAID_X !== "true")
      throw new ProviderError("PAID_API_ACCESS_REQUIRED");
    if (platform === "tiktok") {
      if (process.env.TIKTOK_APP_AUDITED !== "true")
        throw new ProviderError("TIKTOK_APP_AUDIT_REQUIRED");
      if (!verifiedTikTokMediaPrefix())
        throw new ProviderError("VERIFIED_MEDIA_URL_REQUIRED");
    }
    if (
      platform === "youtube" &&
      process.env.YOUTUBE_PROJECT_AUDITED !== "true"
    )
      throw new ProviderError("YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY");
    if (
      platform === "beehiiv" &&
      process.env.BEEHIIV_POSTS_ACCESS_VERIFIED !== "true"
    )
      throw new ProviderError("BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED");
    adapter = nativeAdapters[platform];
  } else {
    throw new ProviderError("UNSUPPORTED_DELIVERY_TRANSPORT");
  }
  return {
    adapter,
    transport,
    platform,
    account_external_id: platformAccount.external_id,
    verified_at: platformAccount.verified_at,
  };
}
