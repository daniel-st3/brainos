import type { Account, Package, Provider } from "./model";
/** A configured identity is not permission to send. External sends remain disabled. */
export class ProviderBlocked extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const capabilities: Record<Provider, string[]> = {
  instagram: ["profile_read", "media_upload", "publish", "analytics"],
  tiktok: ["profile_read", "media_upload", "publish", "analytics"],
  x: ["profile_read", "publish", "analytics"],
  youtube: ["profile_read", "media_upload", "publish", "analytics"],
  beehiiv: ["profile_read", "publish", "analytics"],
};
export function providerAdapter(provider: Provider, account?: Account) {
  const requireConnection = () => {
    if (!account || account.status !== "connected")
      throw new ProviderBlocked(
        "AUTH_REQUIRED",
        `${provider}: ${account?.status ?? "not_created"}; account authorization required`,
      );
  };
  const requireActivation = () => {
    requireConnection();
    throw new ProviderBlocked(
      "POSTING_DISABLED",
      "External posting is disabled; provider send implementation and activation review are required",
    );
  };
  return {
    provider,
    capabilities: capabilities[provider],
    validateConnection() {
      requireConnection();
      return {
        account_id: account!.external_id,
        capabilities: account!.capabilities,
      };
    },
    fetchAccount() {
      requireConnection();
      return { ...account };
    },
    validatePackage(p: Package) {
      if (p.platform !== provider) throw Error("Package/provider mismatch");
      if (!p.title.trim() || !p.caption.trim())
        throw Error("Caption and title required");
      const limit = {
        instagram: 2200,
        tiktok: 2200,
        x: 280,
        youtube: 5000,
        beehiiv: 50000,
      }[provider];
      if (p.caption.length > limit)
        throw Error(`${provider} caption exceeds ${limit} characters`);
      if (provider === "x" && p.thread.some((t) => t.length > 280))
        throw Error("Thread post exceeds 280 characters");
      return { valid: true, external_posting: false };
    },
    schedule: requireActivation,
    publish: requireActivation,
    cancelSchedule: requireActivation,
    createDraft: requireActivation,
    updateDraft: requireActivation,
    fetchPublication() {
      requireConnection();
      throw new ProviderBlocked(
        "PROVIDER_ACTIVATION_REQUIRED",
        "Publication reads require authorized provider transport",
      );
    },
    fetchMetrics() {
      requireConnection();
      throw new ProviderBlocked(
        "PROVIDER_ACTIVATION_REQUIRED",
        "Metrics require authorized provider transport; no values invented",
      );
    },
    normalizeMetrics(raw: Record<string, unknown>) {
      return Object.fromEntries(
        Object.entries(raw).filter(
          ([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0,
        ),
      );
    },
  };
}
