import type { Rpc } from "../ingestion/store";
import { readControl } from "../control/service";
import { OfficialClient, ProviderError, type TokenSet } from "./client";
import { providerToken } from "./auth";
import type { Provider } from "../control/model";
/** One hourly read per connected provider; never publishes or sends mail. */
export async function providerHealth(rpc: Rpc) {
  const initial = await readControl(rpc, false),
    results: Record<string, unknown>[] = [];
  for (const account of initial.entities.filter(
    (e) =>
      e.kind === "account" &&
      ["connected", "degraded"].includes(String(e.data.status)),
  )) {
    if (
      account.data.platform === "x" &&
      process.env.BRAINOS_ALLOW_PAID_X !== "true"
    ) {
      results.push({ provider: "x", state: "BLOCKED_BY_PROVIDER_ACCESS" });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      const tokens: TokenSet = await providerToken(rpc, account.id),
        choices = await new OfficialClient(
          account.data.platform as Provider,
          tokens,
        ).discover(),
        identity = choices.find((c) => c.id === account.data.external_id);
      if (!identity) throw new ProviderError("ACCOUNT_MISMATCH");
      data = {
        ...account.data,
        status: "connected",
        profile: identity,
        capabilities: identity.capabilities,
        verified_at: new Date().toISOString(),
        reason: identity.blockers.join("; ") || null,
      };
    } catch (e) {
      const code =
        e instanceof ProviderError ? e.code : "PROVIDER_HEALTH_FAILED";
      data = {
        ...account.data,
        status: "degraded",
        capabilities: [],
        reason: code,
      };
    }
    const latest = await readControl(rpc, false),
      current = latest.entities.find((e) => e.id === account.id)!;
    if (current.version !== account.version) continue;
    await rpc("commit_control", {
      p_epoch: latest.epoch,
      p_entities: [{ ...current, version: current.version + 1, data }],
      p_jobs: [],
      p_public: [],
      p_actor: "provider-health",
    });
    results.push({ provider: account.data.platform, state: data.status });
  }
  return results;
}
