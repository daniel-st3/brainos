import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sealSecret, openSecret } from "../integrations/google-oauth";
import type { Rpc } from "../ingestion/store";
import type { Provider, Entity, Account } from "../control/model";
import { appConfig, definitions, providerVersion } from "./definitions";
import {
  OfficialClient,
  ProviderError,
  type Identity,
  type TokenSet,
  type Transport,
} from "./client";
import { providerClient } from "./factory";
import { BufferClient } from "./buffer-client";
import { controlAction, readControl } from "../control/service";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const providerCookie = (p: Provider) => `brainos_${p}_oauth`;
export async function startProviderAuth(
  rpc: Rpc,
  p: Provider,
  actor: string,
  accountId: string,
) {
  const c = appConfig(p),
    state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url"),
    id = randomUUID();
  const a = (await readControl(rpc, false)).entities.find(
    (e) => e.id === accountId && e.kind === "account" && e.data.platform === p,
  );
  if (!a) throw Error("Declare this account created before connecting");
  await rpc("save_provider_oauth", {
    p_attempt: {
      id,
      provider: p,
      actor,
      state_hash: hash(state),
      verifier_ciphertext: sealSecret(
        JSON.stringify({ verifier, accountId }),
        `provider-state:${id}`,
      ),
      expires_at: new Date(Date.now() + 600000).toISOString(),
      consumed_at: null,
      created_at: new Date().toISOString(),
    },
  });
  const u = new URL(definitions[p].auth);
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set(
    "scope",
    definitions[p].scopes.join(p === "tiktok" ? "," : " "),
  );
  if (p === "tiktok") {
    u.searchParams.delete("client_id");
    u.searchParams.set("client_key", c.clientId);
  }
  if (p === "youtube") {
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent select_account");
  }
  if (definitions[p].pkce) {
    u.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    u.searchParams.set("code_challenge_method", "S256");
  }
  return {
    url: u.toString(),
    cookie: sealSecret(
      JSON.stringify({ actor, state }),
      `provider-cookie:${p}`,
    ),
  };
}
export async function exchangeToken(
  p: Provider,
  fields: Record<string, string>,
  send: Transport = fetch,
): Promise<TokenSet> {
  const c = appConfig(p),
    body = new URLSearchParams({
      ...fields,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
  if (p === "tiktok") {
    body.delete("client_id");
    body.set("client_key", c.clientId);
  }
  let response: Response;
  try {
    response = await send(definitions[p].token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(p === "x"
          ? {
              Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
            }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new ProviderError("TOKEN_EXCHANGE_NETWORK_FAILED");
  }
  const r = (await response.json().catch(() => {
    throw new ProviderError("TOKEN_EXCHANGE_INVALID_RESPONSE");
  })) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    open_id?: string;
    user_id?: string;
    error?: unknown;
    data?: { access_token: string; user_id: string }[];
  };
  if (!response.ok || r.error) throw new ProviderError("TOKEN_EXCHANGE_FAILED");
  const t = r.data?.length === 1 ? r.data[0] : r;
  if (!t.access_token) throw new ProviderError("ACCESS_TOKEN_MISSING");
  let token: TokenSet = {
    access_token: t.access_token,
    refresh_token: r.refresh_token,
    expires_at: Date.now() + Number(r.expires_in ?? 3600) * 1000,
    scopes: r.scope ? r.scope.split(/[ ,]+/) : [],
    account_id: r.open_id || r.user_id,
  };
  // Instagram short-lived grants exchange for the official renewable long-lived token.
  if (p === "instagram") {
    const u = new URL("https://graph.instagram.com/access_token");
    u.search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: c.clientSecret,
      access_token: token.access_token,
    }).toString();
    const res = await send(u.toString(), {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const q = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !q.access_token)
      throw new ProviderError("LONG_LIVED_EXCHANGE_FAILED");
    token = {
      ...token,
      access_token: q.access_token,
      expires_at: Date.now() + Number(q.expires_in) * 1000,
    };
    const permissions = await new OfficialClient(p, token, send).request(
      "/me/permissions",
    );
    token.scopes = Array.isArray(permissions.data)
      ? permissions.data
          .filter(
            (v: unknown) =>
              typeof v === "object" &&
              v !== null &&
              (v as Record<string, unknown>).status === "granted",
          )
          .map((v: unknown) =>
            String((v as Record<string, unknown>).permission),
          )
      : [];
  }
  return token;
}
export async function finishProviderAuth(
  rpc: Rpc,
  p: Provider,
  actor: string,
  cookie: string,
  state: string,
  code: string,
  send: Transport = fetch,
) {
  const bound = JSON.parse(openSecret(cookie, `provider-cookie:${p}`));
  if (bound.actor !== actor || bound.state !== state)
    throw new ProviderError("OAUTH_COOKIE_MISMATCH");
  const attempt = (await rpc("consume_provider_oauth", {
    p_hash: hash(state),
    p_actor: actor,
    p_provider: p,
  })) as { id: string; verifier_ciphertext: string };
  const { verifier, accountId } = JSON.parse(
      openSecret(attempt.verifier_ciphertext, `provider-state:${attempt.id}`),
    ),
    config = appConfig(p);
  const token = await exchangeToken(
    p,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      ...(definitions[p].pkce ? { code_verifier: verifier } : {}),
    },
    send,
  );
  await installPending(rpc, accountId, p, token, actor, send);
  return { accountId };
}
async function installPending(
  rpc: Rpc,
  id: string,
  p: Provider,
  t: TokenSet,
  actor: string,
  send: Transport,
  discovered?: Identity[],
) {
  const state = await readControl(rpc, false),
    a = state.entities.find((e) => e.id === id && e.kind === "account") as
      Entity<Account> | undefined;
  if (!a || a.data.platform !== p) throw new ProviderError("ACCOUNT_MISMATCH");
  let choices: Identity[] = [],
    reason = "Select the authorized account";
  try {
    choices = discovered ?? (await providerClient(p, t, send).discover());
  } catch (e) {
    if (
      p !== "x" ||
      !(e instanceof ProviderError) ||
      e.code !== "PAID_API_ACCESS_REQUIRED"
    )
      throw e;
    reason =
      "CONNECTED_BUT_WRITE_UNAVAILABLE: X reads/writes require paid API access";
  }
  await rpc("install_provider_connection", {
    p_epoch: state.epoch,
    p_entity: {
      ...a,
      version: a.version + 1,
      data: {
        ...a.data,
        status: "auth_required",
        writes_authorized: false,
        writes_authorized_by: null,
        writes_authorized_at: null,
        choices,
        reason,
        api_version:
          t.transport === "buffer"
            ? "buffer/2026-10-02"
            : definitions[p].version,
        delivery_transport: t.transport ?? "native",
        implementation: providerVersion,
      },
    },
    p_ciphertext: sealSecret(JSON.stringify(t), `provider:${id}`),
    p_actor: actor,
  });
}
export async function installBuffer(
  rpc: Rpc,
  key: string,
  actor: string,
  send: Transport = fetch,
) {
  if (key.length < 10 || key.length > 1000)
    throw Error("Invalid private API credential");
  const token: TokenSet = {
    transport: "buffer",
    access_token: key,
    expires_at: 8640000000000000,
    scopes: [],
  };
  const plans = [];
  const initial = await readControl(rpc, false);
  for (const provider of ["instagram", "tiktok", "x"] as const) {
    const choices = await new BufferClient(provider, token, send).discover();
    if (!choices.length) continue;
    const existing = initial.entities.find(
      (e) => e.kind === "account" && e.data.platform === provider,
    );
    if (
      existing?.data.status === "connected" &&
      existing.data.delivery_transport !== "buffer"
    )
      throw new ProviderError("DISCONNECT_NATIVE_ACCOUNT_BEFORE_BUFFER");
    if (
      existing?.data.external_id &&
      !choices.some((c) => c.id === existing.data.external_id)
    )
      throw new ProviderError("DISCONNECT_BEFORE_ACCOUNT_CHANGE");
    plans.push({ provider, choices, existing });
  }
  if (!plans.length)
    throw new ProviderError("BUFFER_CONNECT_SOCIAL_CHANNELS_FIRST");
  for (const { provider, choices, existing } of plans) {
    if (!existing)
      await controlAction(
        rpc,
        {
          action: "account_create",
          platform: provider,
          handle: choices[0].handle || provider,
        },
        actor,
        false,
      );
    const state = await readControl(rpc, false);
    const account = state.entities.find(
      (e) => e.kind === "account" && e.data.platform === provider,
    )!;
    await installPending(
      rpc,
      account.id,
      provider,
      token,
      actor,
      send,
      choices,
    );
    if (choices.length === 1)
      await selectProviderAccount(rpc, account.id, choices[0].id, actor, send);
  }
  return {
    channels: plans.map((p) => p.provider),
    selection_required: plans.some((p) => p.choices.length > 1),
  };
}
export async function installBeehiiv(
  rpc: Rpc,
  id: string,
  apiKey: string,
  actor: string,
  send: Transport = fetch,
) {
  if (apiKey.length < 10 || apiKey.length > 1000)
    throw Error("Invalid private API credential");
  return installPending(
    rpc,
    id,
    "beehiiv",
    {
      access_token: apiKey,
      expires_at: 8640000000000000,
      scopes: definitions.beehiiv.scopes,
    },
    actor,
    send,
  );
}
export async function selectProviderAccount(
  rpc: Rpc,
  id: string,
  externalId: string,
  actor: string,
  send: Transport = fetch,
) {
  const state = await readControl(rpc, false),
    a = state.entities.find((e) => e.id === id && e.kind === "account");
  if (!a) throw Error("Account missing");
  const token = await providerToken(rpc, id, send),
    choices = await providerClient(
      a.data.platform as Provider,
      token,
      send,
    ).discover(),
    selected = choices.find((c) => c.id === externalId);
  if (!selected) throw new ProviderError("ACCOUNT_MISMATCH");
  if (a.data.external_id && a.data.external_id !== selected.id)
    throw new ProviderError("DISCONNECT_BEFORE_ACCOUNT_CHANGE");
  await rpc("install_provider_connection", {
    p_epoch: state.epoch,
    p_entity: {
      ...a,
      version: a.version + 1,
      data: {
        ...a.data,
        status: "connected",
        external_id: selected.id,
        handle: selected.handle,
        capabilities: selected.capabilities,
        verified_at: new Date().toISOString(),
        reason: selected.blockers.join("; ") || null,
        profile: selected,
        choices: [],
      },
    },
    p_ciphertext: sealSecret(
      JSON.stringify({ ...token, account_id: selected.id }),
      `provider:${id}`,
    ),
    p_actor: actor,
  });
}
export async function providerToken(
  rpc: Rpc,
  id: string,
  send: Transport = fetch,
): Promise<TokenSet> {
  const encrypted = (await rpc("provider_secret", { p_id: id })) as
    string | null;
  if (!encrypted) throw new ProviderError("AUTH_REQUIRED");
  let t = JSON.parse(openSecret(encrypted, `provider:${id}`)) as TokenSet;
  if (t.expires_at > Date.now() + 7 * 86400000) return t;
  const a = (await readControl(rpc, false)).entities.find(
      (e) => e.id === id && e.kind === "account",
    ),
    p = a?.data.platform as Provider;
  if (!p) throw new ProviderError("ACCOUNT_MISMATCH");
  if (p !== "instagram" && t.expires_at > Date.now() + 120000) return t;
  const lease = randomUUID();
  if (
    !(await rpc("claim_provider_refresh", {
      p_id: id,
      p_expected: encrypted,
      p_token: lease,
    }))
  )
    throw new ProviderError("REFRESH_IN_PROGRESS", true, false, 60);
  try {
    if (p === "instagram") {
      if (t.expires_at <= Date.now())
        throw new ProviderError("REAUTH_REQUIRED");
      const u = new URL("https://graph.instagram.com/refresh_access_token");
      u.search = new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: t.access_token,
      }).toString();
      const r = await send(u.toString(), {
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        }),
        v = (await r.json()) as { access_token: string; expires_in: number };
      if (!r.ok || !v.access_token) throw new ProviderError("REFRESH_FAILED");
      t = {
        ...t,
        access_token: v.access_token,
        expires_at: Date.now() + v.expires_in * 1000,
      };
    } else {
      if (!t.refresh_token) throw new ProviderError("REAUTH_REQUIRED");
      const renewed = await exchangeToken(
        p,
        { grant_type: "refresh_token", refresh_token: t.refresh_token },
        send,
      );
      t = {
        ...renewed,
        account_id: t.account_id,
        refresh_token: renewed.refresh_token ?? t.refresh_token,
        scopes: renewed.scopes.length ? renewed.scopes : t.scopes,
      };
    }
    await rpc("finish_provider_refresh", {
      p_id: id,
      p_token: lease,
      p_ciphertext: sealSecret(JSON.stringify(t), `provider:${id}`),
    });
    return t;
  } catch (e) {
    await rpc("finish_provider_refresh", {
      p_id: id,
      p_token: lease,
      p_ciphertext: null,
    }).catch(() => {});
    throw e;
  }
}
export async function disconnectProvider(
  rpc: Rpc,
  id: string,
  actor: string,
  send: Transport = fetch,
) {
  const state = await readControl(rpc, false),
    a = state.entities.find((e) => e.id === id && e.kind === "account");
  if (!a) throw Error("Account missing");
  let revoke = "revoked";
  try {
    const token = await providerToken(rpc, id, send);
    if (token.transport === "buffer")
      revoke =
        "Local credential removed. Disconnect the channel or revoke the shared key in Buffer settings when appropriate; other connected channels may use it.";
    else if (
      a.data.platform === "youtube" &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_ID === process.env.GOOGLE_CLIENT_ID
    )
      revoke =
        "Local YouTube credential removed. Shared Google authorization preserved for Drive. Revoke BrainOS in Google account permissions to revoke all shared access, including Drive.";
    else
      await new OfficialClient(
        a.data.platform as Provider,
        token,
        send,
      ).revoke();
  } catch {
    revoke = "local removal complete; provider-side revocation requires review";
  }
  await rpc("disconnect_provider", {
    p_epoch: state.epoch,
    p_entity: {
      ...a,
      version: a.version + 1,
      data: {
        ...a.data,
        status: "revoked",
        writes_authorized: false,
        writes_authorized_by: null,
        writes_authorized_at: null,
        capabilities: [],
        external_id: null,
        choices: [],
        reason: revoke,
      },
    },
    p_actor: actor,
  });
}

/** No callback URL, authorization code or provider error body enters the audit. */
export async function recordOAuthFailure(rpc: Rpc, p: Provider, actor: string) {
  const state = await readControl(rpc, false),
    key = `oauth-failure:${p}:${Math.floor(Date.now() / 600000)}`;
  if (
    state.entities.some((e) => e.kind === "notification" && e.data.key === key)
  )
    return;
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        id: randomUUID(),
        kind: "notification",
        version: 1,
        story_id: null,
        draft_id: null,
        parent_id: null,
        is_demo: false,
        data: {
          key,
          type: "oauth_failure",
          subsystem: "OAuth",
          title: `${p}: authorization callback failed`,
          href: "/activation",
          status: "unread",
          read_at: null,
          created_at: new Date().toISOString(),
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: actor,
  });
}
